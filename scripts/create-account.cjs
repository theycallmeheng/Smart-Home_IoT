/* Cấp tài khoản trên máy backend; mật khẩu không truyền qua tham số lệnh. */
const readline = require('node:readline');
const { Writable } = require('node:stream');
const { resolve } = require('node:path');
const { createAuth } = require('../backend/auth.cjs');

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('Hãy chạy lệnh trong terminal tương tác để nhập mật khẩu ẩn.');
  console.log('Cấp tài khoản IoT Control (không có đăng ký công khai).');
  let hidden = false;
  const output = new Writable({
    write(chunk, encoding, done) {
      if (!hidden) process.stdout.write(chunk, encoding);
      done();
    },
  });
  // Giữ một console suốt quá trình nhập, tránh bật/tắt raw mode trên Windows.
  const input = readline.createInterface({
    input: process.stdin,
    output,
    terminal: true,
    historySize: 0,
  });
  const question = (text) =>
    new Promise((answer, reject) => {
      const cancelled = () => reject(new Error('Đã hủy tạo tài khoản.'));
      input.once('close', cancelled);
      input.question(text, (value) => {
        input.off('close', cancelled);
        answer(value);
      });
    });
  input.on('SIGINT', () => input.close());
  const secret = async (prompt) => {
    hidden = true;
    process.stdout.write(prompt);
    try {
      return await question('');
    } finally {
      hidden = false;
      process.stdout.write('\n');
    }
  };
  try {
    const username = await question('Tên đăng nhập (3–32 ký tự): ');
    const name = await question('Tên hiển thị: ');
    const password = await secret('Mật khẩu (8–128 ký tự, nhập ẩn): ');
    const confirm = await secret('Nhập lại mật khẩu: ');
    if (password !== confirm) throw new Error('Hai mật khẩu không khớp. Chưa tạo tài khoản.');
    hidden = true;
    const auth = createAuth({
      filename: process.env.AUTH_DATABASE_PATH || resolve(__dirname, '../data/auth.sqlite'),
    });
    try {
      const user = await auth.createUser({ username, name, password });
      console.log(`Đã cấp tài khoản "${user.username}" cho ${user.name}.`);
    } finally {
      auth.close();
    }
  } finally {
    try {
      input.close();
    } catch (reason) {
      // Một số console Windows đã đóng handle trước bước khôi phục raw mode.
      if (reason.code !== 'EPERM') throw reason;
    } finally {
      process.stdin.destroy();
      output.end();
    }
  }
}
if (require.main === module)
  // Xả thông báo rồi kết thúc CLI, kể cả khi console Windows còn giữ stdin.
  main().then(
    () => process.stdout.write('', () => process.exit(0)),
    (reason) => {
      console.error(reason.message);
      process.stderr.write('', () => process.exit(1));
    },
  );
