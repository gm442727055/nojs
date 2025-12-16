// 阿里云Pages函数（Serverless）的WebSocket数据中转服务
const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const url = require('url');

// 阿里云Pages函数的入口handler（必须导出）
exports.handler = async (req, res) => {
  // 创建HTTP服务器，挂载WebSocket服务
  const server = http.createServer((_req, _res) => {
    _res.writeHead(200, { 'Content-Type': 'text/plain' });
    _res.end('WebSocket数据中转服务运行中\n');
  });

  // 初始化WebSocket服务器
  const wss = new WebSocket.Server({ noServer: true });

  // 处理HTTP服务器的升级请求（WebSocket握手）
  server.on('upgrade', (upgradeReq, socket, head) => {
    // 解析请求中的目标服务器参数（格式：ws://your-aliyun-domain.com?target=host:port）
    const query = url.parse(upgradeReq.url, true).query;
    const target = query.target;
    if (!target) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\nMissing target parameter');
      socket.destroy();
      return;
    }

    // 完成WebSocket握手
    wss.handleUpgrade(upgradeReq, socket, head, (ws) => {
      wss.emit('connection', ws, upgradeReq, target);
    });
  });

  // 处理WebSocket连接
  wss.on('connection', (ws, _req, target) => {
    let tcpClient = null; // 连接目标服务器的TCP客户端
    const [host, port] = target.split(':');

    try {
      // 连接目标服务器
      tcpClient = net.connect({ host, port, timeout: 5000 }, () => {
        console.log(`成功连接到目标服务器：${target}`);
        ws.send(JSON.stringify({ type: 'connect', status: 'success' }));
      });

      // 目标服务器数据转发到WebSocket客户端
      tcpClient.on('data', (data) => {
        if (ws.readyState === WebSocket.OPEN) {
          // 二进制数据直接转发（也可根据需求序列化）
          ws.send(data);
        }
      });

      // 目标服务器连接关闭
      tcpClient.on('close', () => {
        console.log(`目标服务器${target}连接关闭`);
        ws.close(1000, 'Target server closed');
      });

      // 目标服务器连接超时/错误
      tcpClient.on('timeout', () => {
        ws.close(1003, 'Connect to target server timeout');
        tcpClient.destroy();
      });
      tcpClient.on('error', (err) => {
        console.error(`目标服务器错误：${err.message}`);
        ws.close(1003, `Target server error: ${err.message}`);
        tcpClient.destroy();
      });

      // WebSocket客户端数据转发到目标服务器
      ws.on('message', (data) => {
        if (tcpClient && tcpClient.writable) {
          // 若客户端发送的是字符串，转Buffer；二进制数据直接写入
          const sendData = typeof data === 'string' ? Buffer.from(data) : data;
          tcpClient.write(sendData);
        }
      });

      // WebSocket客户端连接关闭
      ws.on('close', (code, reason) => {
        console.log(`客户端断开连接：${code} - ${reason}`);
        if (tcpClient) tcpClient.destroy();
      });

      // WebSocket错误处理
      ws.on('error', (err) => {
        console.error(`WebSocket错误：${err.message}`);
        if (tcpClient) tcpClient.destroy();
      });
    } catch (err) {
      console.error(`中转初始化失败：${err.message}`);
      ws.close(1003, `Init failed: ${err.message}`);
      if (tcpClient) tcpClient.destroy();
    }
  });

  // 将阿里云的HTTP请求转发到本地服务器
  server.emit('request', req, res);
};
