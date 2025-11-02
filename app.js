const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// -------------------------- 配置项（已适配新地址）--------------------------
const CONFIG = {
    HYSTERIA_VERSION: "v2.6.4", // 更新为新版本
    SERVER_PORT: 20268,
    AUTH_PASSWORD: "xiamumaxiamuma", // 建议改复杂密码
    CERT_FILE: "cert.pem",
    KEY_FILE: "key.pem",
    SNI: "www.bing.com",
    ALPN: "h3"
};
// ----------------------------------------------------------------------------

function log(msg, type = "info") {
    const prefix = {
        info: "[部署流程] ✅",
        warn: "[部署流程] ⚠️",
        error: "[部署流程] ❌"
    }[type];
    console.log(`${prefix} ${msg}`);
}

function runCmd(cmd, options = {}) {
    try {
        execSync(cmd, {
            stdio: options.silent ? "ignore" : "inherit",
            cwd: path.resolve(__dirname),
            timeout: 300000 // 5分钟超时，确保下载完成
        });
    } catch (err) {
        log(`命令执行失败：${cmd}\n原因：${err.message}`, "error");
        process.exit(1);
    }
}

// 检测架构（适配amd64/arm64，你的之前是arm64，也兼容）
function checkArch() {
    log("1. 检测服务器架构...");
    const machine = execSync('uname -m').toString().trim().toLowerCase();
    let arch = "";

    if (machine.includes("arm64") || machine.includes("aarch64")) {
        arch = "arm64";
    } else if (machine.includes("x86_64") || machine.includes("amd64")) {
        arch = "amd64";
    } else {
        log(`不支持的架构：${machine}，仅支持arm64/amd64`, "error");
        process.exit(1);
    }
    log(`架构检测完成：${arch}`);
    return arch;
}

// 使用你提供的可正常访问的新地址下载
function downloadHysteria(arch) {
    log("2. 下载Hysteria2二进制文件（使用可访问地址）...");
    const binName = `hysteria-linux-${arch}`;
    const binPath = path.join(__dirname, binName);

    // 删除旧的损坏文件
    if (fs.existsSync(binPath)) {
        const fileSize = fs.statSync(binPath).size;
        if (fileSize < 1024 * 1024) {
            log(`删除损坏旧文件（${fileSize}字节）...`);
            fs.unlinkSync(binPath);
        } else {
            log(`二进制文件已存在，跳过下载`);
            runCmd(`chmod +x ${binPath}`);
            return binPath;
        }
    }

    // 你的可正常使用的下载地址（自动适配架构）
    const downloadUrl = `https://github.com/apernet/hysteria/releases/download/app%2F${CONFIG.HYSTERIA_VERSION}/${binName}`;
    log(`开始下载：${downloadUrl}`);
    
    // 带进度条下载，方便查看状态
    runCmd(`curl -# -L --retry 5 --connect-timeout 30 -o "${binPath}" "${downloadUrl}"`);
    runCmd(`chmod +x ${binPath}`); // 赋予执行权限

    // 验证文件大小（至少10MB，确保完整）
    const fileSize = fs.statSync(binPath).size;
    if (fileSize < 10 * 1024 * 1024) {
        log(`文件不完整（仅${Math.round(fileSize/1024)}KB），请检查网络后重试`, "error");
        process.exit(1);
    }

    log(`下载完成：${binName}（${Math.round(fileSize/1024/1024)}MB）`);
    return binPath;
}

// 生成自签证书
function generateCert() {
    log("3. 处理TLS证书...");
    const certPath = path.join(__dirname, CONFIG.CERT_FILE);
    const keyPath = path.join(__dirname, CONFIG.KEY_FILE);

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        log(`使用现有证书：${CONFIG.CERT_FILE}/${CONFIG.KEY_FILE}`);
        return;
    }

    log("生成自签证书（有效期10年）...");
    runCmd(`openssl req -x509 -nodes -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
        -days 3650 -keyout "${keyPath}" -out "${certPath}" -subj "/CN=${CONFIG.SNI}"`);
    log(`证书生成完成`);
}

// 生成配置文件
function writeConfig() {
    log("4. 生成服务器配置文件...");
    const configPath = path.join(__dirname, "server.yaml");
    const configContent = `listen: ":${CONFIG.SERVER_PORT}"
tls:
  cert: "${path.join(__dirname, CONFIG.CERT_FILE)}"
  key: "${path.join(__dirname, CONFIG.KEY_FILE)}"
  alpn:
    - "${CONFIG.ALPN}"
auth:
  type: "password"
  password: "${CONFIG.AUTH_PASSWORD}"
bandwidth:
  up: "200mbps"
  down: "200mbps"
quic:
  max_idle_timeout: "10s"
  max_concurrent_streams: 4
  initial_stream_receive_window: 65536        # 64 KB
  max_stream_receive_window: 131072           # 128 KB
  initial_conn_receive_window: 131072         # 128 KB
  max_conn_receive_window: 262144             # 256 KB`;

    fs.writeFileSync(configPath, configContent, "utf-8");
    log(`配置文件生成完成：server.yaml`);
    return configPath;
}

// 获取公网IP
function getServerIp() {
    log("5. 获取公网IP...");
    try {
        const ip = execSync('curl -s --max-time 10 https://api.ipify.org').toString().trim();
        log(`公网IP检测成功：${ip}`);
        return ip;
    } catch (err) {
        log("无法自动获取IP，使用占位符（需手动替换）", "warn");
        return "YOUR_SERVER_IP";
    }
}

// 打印连接信息
function printResult(ip, binPath, configPath) {
    log("6. 部署完成，显示连接信息...");
    const nodeLink = `hysteria2://${CONFIG.AUTH_PASSWORD}@${ip}:${CONFIG.SERVER_PORT}?sni=${CONFIG.SNI}&alpn=${CONFIG.ALPN}#Hy2-Deploy`;

    console.log("\n" + "=".repeat(60));
    console.log("🎉 Hysteria2 部署成功！（v2.6.4版本）");
    console.log("=".repeat(60));
    console.log("📋 核心信息：");
    console.log(`   🌐 IP地址：${ip}`);
    console.log(`   🔌 端口：${CONFIG.SERVER_PORT}`);
    console.log(`   🔑 密码：${CONFIG.AUTH_PASSWORD}`);
    console.log(`   📱 节点链接：${nodeLink}`);
    console.log("\n📋 客户端配置（参考）：");
    console.log(`server: ${ip}:${CONFIG.SERVER_PORT}`);
    console.log(`auth: ${CONFIG.AUTH_PASSWORD}`);
    console.log(`tls:`);
    console.log(`  sni: ${CONFIG.SNI}`);
    console.log(`  alpn: ["${CONFIG.ALPN}"]`);
    console.log(`  insecure: true`); // 自签证书需开启
    console.log("=".repeat(60) + "\n");
}

// 启动服务器
function startHysteria(binPath, configPath) {
    log("7. 启动Hysteria2服务器...");
    log(`启动命令：${path.basename(binPath)} server -c ${path.basename(configPath)}`);
    console.log("\n🚀 服务器日志如下：\n");
    runCmd(`${binPath} server -c ${configPath}`, { silent: false });
}

// 主流程
function main() {
    console.log("\n" + "~".repeat(70));
    console.log("Hysteria2 部署脚本（v2.6.4适配版）");
    console.log("~".repeat(70) + "\n");

    const arch = checkArch();
    const binPath = downloadHysteria(arch);
    generateCert();
    const configPath = writeConfig();
    const serverIp = getServerIp();
    printResult(serverIp, binPath, configPath);
    startHysteria(binPath, configPath);
}

main();