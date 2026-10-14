/* Tạo cấu hình riêng từ sketch cũ, không in mật khẩu ra terminal. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  process.argv[2] || path.resolve(root, '..', 'sketch_sep16a', 'sketch_sep16a.ino'),
  'utf8',
);
const valueOf = (name) => {
  const match = source.match(
    new RegExp('const\\s+char\\s*\\*\\s*' + name + '\\s*=\\s*("(?:\\\\.|[^"\\\\])*?")\\s*;'),
  );
  if (!match)
    throw new Error(
      `Không tìm thấy cấu hình ${name}; dùng .env.example và secrets.example.h để điền thủ công.`,
    );
  return JSON.parse(match[1]);
};
const values = {
  WIFI_SSID: valueOf('ssid'),
  WIFI_PASSWORD: valueOf('password'),
  MQTT_HOST: valueOf('mqtt_server'),
  MQTT_USER: valueOf('mqtt_user'),
  MQTT_PASSWORD: valueOf('mqtt_pass'),
};
const port = Number(source.match(/const\s+int\s+mqtt_port\s*=\s*(\d+)/)?.[1] || 1884);
const env = path.join(root, '.env');
if (!fs.existsSync(env))
  fs.writeFileSync(
    env,
    `HOST=127.0.0.1\nPORT=3000\nMQTT_URL=mqtt://127.0.0.1:${port}\nMQTT_USERNAME=${JSON.stringify(values.MQTT_USER)}\nMQTT_PASSWORD=${JSON.stringify(values.MQTT_PASSWORD)}\nDATABASE_PATH=./data/iot.sqlite\nAUTH_DATABASE_PATH=./data/auth.sqlite\nCOMMAND_TIMEOUT_MS=8000\nDEVICE_STALE_MS=15000\n`,
  );
const header = path.join(root, 'hardware', 'iot_control', 'secrets.h');
if (!fs.existsSync(header))
  fs.writeFileSync(
    header,
    '#pragma once\n' +
      Object.entries(values)
        .map(([name, value]) => `const char* ${name} = ${JSON.stringify(value)};`)
        .join('\n') +
      `\nconst int MQTT_PORT = ${port};\n`,
  );
console.log(
  'Cấu hình .env và hardware/iot_control/secrets.h đã sẵn sàng; giữ nguyên file cấu hình đã có.',
);
// Báo cấu hình IP cũ, không ghi đè cấu hình riêng đã được người dùng sửa.
const configuredHost = fs.readFileSync(header, 'utf8').match(/MQTT_HOST\s*=\s*"([^"]+)"/)?.[1];
const localAddresses = Object.values(os.networkInterfaces())
  .flat()
  .filter((entry) => entry.family === 'IPv4' && !entry.internal)
  .map((entry) => entry.address);
if (
  configuredHost &&
  /^\d+\.\d+\.\d+\.\d+$/.test(configuredHost) &&
  localAddresses.length &&
  !localAddresses.includes(configuredHost)
) {
  console.warn(
    'MQTT_HOST trong secrets.h không trùng IPv4 hiện tại của máy tính. Kiểm tra IP và WiFi trước khi Upload.',
  );
}
