/* Xuất từng tab độc lập; Figma luôn dùng dữ liệu mẫu. */
const fs = require('node:fs');
const path = require('node:path');
const prettier = require('prettier');
const root = path.resolve(__dirname, '..');
const options = JSON.parse(fs.readFileSync(path.join(root, '.prettierrc.json'), 'utf8'));
const pages = {
  'index.html': 'dashboard.html',
  'data-sensor.html': 'data-sensor.html',
  'action-history.html': 'action-history.html',
  'profile.html': 'profile.html',
  'login.html': 'login.html',
};
const liveScripts = new Set(['iot-api.js', 'live-dashboard.js', 'live-tables.js', 'login.js']);
(async () => {
  fs.mkdirSync(path.join(root, 'figma-export'), { recursive: true });
  for (const [source, output] of Object.entries(pages)) {
    let html = fs.readFileSync(path.join(root, source), 'utf8');
    // Bản thiết kế đăng nhập chỉ để xem/import, không gửi mật khẩu.
    if (source === 'login.html') html = html.replace(/<(input|button)\b/g, '<$1 disabled');
    html = html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/>/g, (_, href) => {
      const asset = href.split('?')[0];
      return `<style data-source="${asset}">\n${fs.readFileSync(path.join(root, asset), 'utf8')}\n</style>`;
    });
    const scripts = [];
    html = html.replace(/<script\s+src="([^"]+)"\s+defer><\/script>/g, (_, src) => {
      const asset = src.split('?')[0];
      if (!liveScripts.has(asset))
        scripts.push(
          `<script data-source="${asset}">\n${fs.readFileSync(path.join(root, asset), 'utf8').replace(/<\/script/gi, '<\\/script')}\n</script>`,
        );
      return '';
    });
    html = html.replaceAll('href="index.html"', 'href="dashboard.html"');
    html = html.replace(
      '<head>',
      `<head>\n<!-- Bản xuất ${output} cho Figma, nhúng sẵn CSS/JS và dữ liệu mẫu. -->`,
    );
    html = html.replace('</body>', `${scripts.join('\n')}\n</body>`);
    fs.writeFileSync(
      path.join(root, 'figma-export', output),
      await prettier.format(html, { ...options, parser: 'html' }),
    );
  }
  console.log('Đã xuất 5 trang vào figma-export.');
})().catch((reason) => {
  console.error(reason.message);
  process.exitCode = 1;
});
