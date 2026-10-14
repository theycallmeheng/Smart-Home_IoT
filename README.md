# IoT Control

Giao diện HTML/CSS/JavaScript thuần cho IoT Control. Backend Node.js dùng MQTT.js để kết nối ESP8266 qua Mosquitto và SQLite để lưu cảm biến, lịch sử điều khiển.

## Chạy với phần cứng

Yêu cầu Node.js 24 trở lên. Trong thư mục project, chạy `npm.cmd install`, `npm.cmd run setup:hardware`, `npm.cmd run account:create`, rồi `npm.cmd start`. Cấu hình riêng được tạo từ sketch Arduino cũ nếu còn trong project. Trên Windows, `npm.cmd start` dùng Mosquitto đã chạy hoặc mở broker bằng cấu hình hiện có khi cổng 1884 chưa hoạt động. Mở [http://localhost:3000/](http://localhost:3000/).

## Đăng nhập tài khoản được cấp

Chạy `npm.cmd run account:create` trong terminal để cấp từng tài khoản: nhập tên đăng nhập, tên hiển thị và mật khẩu hai lần. Mật khẩu được che khi nhập, cần 8–128 ký tự; không có tài khoản mặc định hoặc đăng ký công khai. Tên đăng nhập gồm 3–32 chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang. Không cần khởi động lại backend sau khi cấp thêm tài khoản.

Nếu backend đang chạy phiên bản cũ, nhấn **Ctrl+C** rồi chạy lại `npm.cmd start`. Mở [trang đăng nhập](http://localhost:3000/login.html). Sau khi đăng nhập, tên tài khoản hiện ở sidebar và nút **Đăng xuất** hiện ở đầu mỗi tab. Các lệnh điều khiển ghi tên người đang đăng nhập vào lịch sử. Mọi tài khoản được cấp đều có quyền xem dữ liệu và điều khiển 3 thiết bị.

Tài khoản được lưu riêng tại `data/auth.sqlite` (đổi bằng `AUTH_DATABASE_PATH`); mật khẩu lưu bằng scrypt với salt riêng. Phiên có thời hạn 8 giờ, dùng cookie HttpOnly/SameSite và bị thu hồi khi đăng xuất. API dữ liệu, điều khiển và luồng cập nhật đều yêu cầu phiên hợp lệ. Đăng nhập sai quá nhiều lần bị giới hạn trong 10 phút. Không chia sẻ hoặc đưa database tài khoản lên Git. Đây là backend cục bộ, mặc định chỉ nghe tại `127.0.0.1`.

Trên PowerShell, dùng `npm.cmd` để tránh lỗi chính sách chạy `npm.ps1`. Các file demo mở trực tiếp và bản xuất Figma vẫn dùng dữ liệu mẫu độc lập; không truy cập được API phần cứng nếu chưa đăng nhập.

Nạp `hardware/iot_control/iot_control.ino` vào ESP8266 để dùng 3 đèn test: D1=đèn, D5=quạt, D6=điều hòa. Giữ DHT11 tại D4 và ánh sáng tại A0. Xem [HARDWARE-INTEGRATION.md](HARDWARE-INTEGRATION.md) để cấu hình IP, nối chân và chạy thử. `.env`, `secrets.h` và dữ liệu SQLite không được đưa vào Git.

Chế độ phần cứng không tự báo thành công sau 500ms: chờ mã xác nhận và trạng thái GPIO, báo lỗi khi timeout/mất kết nối. Ánh sáng thật có đơn vị ADC. Giao diện có thể đổi qua Dữ liệu mẫu bằng nút ở đầu trang; các mô tả dữ liệu tĩnh bên dưới áp dụng cho chế độ mẫu. Nếu dùng Live Server 5500, chọn Dùng phần cứng và vẫn cần backend 3000 đang chạy.

## Mở giao diện mẫu

Mở `index.html` trực tiếp trong trình duyệt. Sidebar dẫn đến các trang:

- `index.html`: Dashboard, biểu đồ cảm biến chi tiết và công tắc quạt, điều hòa, đèn.
- `data-sensor.html`: Bảng dữ liệu cảm biến mẫu.
- `action-history.html`: Bảng lịch sử điều khiển mẫu.
- `profile.html`: Thông tin sinh viên và tài nguyên dự án.
- `login.html`: Trang đăng nhập tài khoản được cấp, cần backend để xác thực.

Tất cả trang dùng chung `styles.css`, có bố cục thích ứng với điện thoại và máy tính. Dashboard dùng thêm `dashboard.css` và `dashboard.js` để hiển thị giao diện và cập nhật số thiết bị đang bật. Data Sensor và Action History dùng chung `tables.js`; hoạt động khi mở file HTML trực tiếp, không cần server khi dùng chế độ mẫu.

`sensor-chart.js` xử lý biểu đồ: ba đường cùng một vùng vẽ, nhiệt độ đọc theo trục °C bên trái, độ ẩm theo trục % và ánh sáng theo trục lux bên phải; 12 mốc từ 35 bản ghi mẫu trong Data Sensor. Rê chuột, chạm biểu đồ hoặc dùng thanh trượt để xem giá trị từng mốc. Thống kê gồm thấp nhất, trung bình, cao nhất và số điểm đo; mốc thiếu dữ liệu được để trống. Thẻ cảm biến hiển thị giá trị mẫu mới nhất. Bố cục Dashboard được thu gọn theo chiều cao màn hình máy tính; màn hình hẹp chuyển sang bố cục dọc để giữ nội dung dễ đọc.

## Phạm vi chức năng

Điều hướng hoạt động qua liên kết HTML. Dashboard có đúng 3 thiết bị: quạt, điều hòa và đèn. Công tắc dùng checkbox và CSS để đổi trạng thái trên giao diện, không điều khiển thiết bị thực và không lưu trạng thái khi tải lại. Quạt quay, điều hòa có hiệu ứng luồng gió và đèn có hiệu ứng ánh sáng khi bật; các hiệu ứng dừng khi tắt và tự tắt khi người dùng bật tùy chọn giảm chuyển động của hệ điều hành. Số thiết bị đang bật cập nhật theo công tắc. Nút `?` mở hướng dẫn bằng phần tử HTML `details`.

Mỗi thao tác bật/tắt có độ trễ mô phỏng 500ms. Trong lúc chờ, thiết bị hiển thị **Đang xử lý…** và công tắc đó tạm khóa; trạng thái, hiệu ứng và bộ đếm chỉ cập nhật khi hoàn tất. Các thiết bị khác vẫn có thể được điều khiển độc lập.

Dữ liệu và biểu đồ là mẫu tĩnh. Nhập từ khóa hoặc chọn bộ lọc, rồi bấm **Filter** ở Data Sensor hoặc **Find** ở Action History (hoặc nhấn **Enter** trong ô tìm kiếm) để áp dụng điều kiện. Bảng giữ kết quả hiện tại cho đến khi xác nhận. Phạm vi tìm kiếm khác nhau theo trang:

- Data Sensor: chọn Sensor ở bên trái, rồi nhập thông tin vào ô tìm kiếm ngay bên cạnh. Tìm trên ID, loại cảm biến, giá trị, đơn vị và ngày/giờ của những dòng thuộc sensor đã chọn. All Value cho phép tìm ở mọi sensor. Menu Sensor có thêm Thời gian: lựa chọn này tìm trên cột TIME của mọi loại cảm biến.
- Action History: chỉ tìm cột thời gian (TIME), có thể nhập đầy đủ `10:31:15` hoặc một phần như `10:31`. Bảng có thêm cột **Người điều khiển**, hiển thị Admin hoặc Nguyễn Đức Hưng trong dữ liệu mẫu.

Tìm kiếm không phân biệt chữ hoa/thường, dấu tiếng Việt hoặc khoảng trắng thừa. Trong Data Sensor, nhiều từ có thể nằm ở các cột khác nhau; ví dụ chọn Humidity rồi nhập `65 %` để tìm giá trị độ ẩm. Tìm kiếm kết hợp với các bộ lọc:

- Data Sensor: menu gồm All Value, Temperature, Humidity, Light và Thời gian. Nhập ngày như `07/10/2026`, giờ như `10:32`, hoặc cả ngày và giờ vào Search; bấm Filter để áp dụng.
- Action History: Device (Light, Fan, Air Condition), Action và Status (Success/Failed/Pending).

Chọn All Value hoặc All Statuses để bỏ điều kiện lọc tương ứng, rồi bấm Filter/Find. Xóa từ khóa và bấm Filter/Find để khôi phục các dòng phù hợp với bộ lọc đang chọn. Số dòng cập nhật theo kết quả; khi không có kết quả, bảng hiển thị thông báo.

Nút **Clear all** trên Data Sensor và Action History xóa từ khóa tìm kiếm, đặt Sensor/Device/Action/Status về All và hiển thị lại toàn bộ dữ liệu.

Dữ liệu mẫu có 35 dòng cảm biến và 35 dòng lịch sử. Mặc định 10 dòng/trang; chọn 5, 10, 20 hoặc 50 tại Dòng/trang ở cuối bảng. Đổi số dòng đưa về trang 1 và giữ kết quả đã xác nhận, không áp dụng điều kiện đang nhập. Dùng Đầu, Trước, số trang, Sau hoặc Cuối để chuyển trang. Tìm kiếm và bộ lọc áp dụng trên toàn bộ dữ liệu, rồi chia trang kết quả. Filter/Find và Clear all đưa về trang 1, giữ số dòng/trang đã chọn; nhập điều kiện mới chưa thay đổi kết quả cho đến khi bấm nút xác nhận hoặc Enter. Cột TIME hiển thị ngày/tháng/năm và giờ/phút/giây; dữ liệu mẫu dùng ngày 07/10/2026. Trong Profile, GitHub và Figma mở trong tab mới; Postman và PDF chờ đường dẫn.

Profile đã hiển thị Nguyễn Đức Hưng, mã sinh viên B23DCCN368. Muốn cập nhật thông tin, sửa tên ở tiêu đề hồ sơ và dòng Họ và tên, rồi sửa Mã sinh viên trong `profile.html`. Khi có URL Postman hoặc PDF, thay nút tương ứng bằng liên kết `<a href="URL" target="_blank" rel="noopener noreferrer">Open</a>`; CSS đã tạo kiểu cho cả nút và liên kết. Cập nhật cả `figma-export/profile.html` khi cần import phiên bản mới vào Figma.

## Kiểm tra

Chạy `npm.cmd test` để kiểm tra độ trễ thiết bị, biểu đồ, tìm kiếm, bộ lọc, phân trang với 5/10/20/50 dòng, kết quả rỗng và Clear all. Bộ kiểm tra gồm dữ liệu mẫu, DOM bằng jsdom, API/SQLite, đăng nhập/đăng xuất, mật khẩu băm, hết phiên, chặn truy cập chưa đăng nhập, xác nhận lệnh và broker MQTT test riêng nếu có Mosquitto. Không gửi lệnh test tới phần cứng thật.

## Định dạng mã

HTML được xuống dòng theo từng phần tử; CSS có mỗi thuộc tính trên một dòng. Tất cả file dùng UTF-8, thụt lề 2 khoảng trắng và xuống dòng LF. Các khối chính có chú thích để dễ tìm và chỉnh sửa.

`.editorconfig` và `.prettierrc.json` lưu quy tắc định dạng chung. Để định dạng lại sau khi sửa, chạy:

```powershell
npm.cmd run format
```

Prettier chỉ dùng khi định dạng mã; mở web không cần cài công cụ này.

## Cách đọc và chỉnh sửa mã

Các file HTML, CSS và JavaScript có chú thích tiếng Việt ngay cạnh phần liên quan. Chú thích HTML dùng `<!-- ... -->`, CSS dùng `/* ... */`, JavaScript dùng `// ...` hoặc `/* ... */`; các chú thích này không hiển thị thành nội dung trên trang.

| File                  | Nội dung cần đọc                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `index.html`          | Cấu trúc Dashboard, thẻ cảm biến, biểu đồ SVG và 3 công tắc.                               |
| `styles.css`          | Màu chung, sidebar, bảng, hồ sơ, Flexbox/Grid và bố cục theo màn hình.                     |
| `dashboard.css`       | Kiểu riêng Dashboard, cánh quạt quay, luồng gió, tia sáng và vòng chờ.                     |
| `dashboard.js`        | Sự kiện công tắc, trạng thái đã áp dụng, khóa khi chờ 500ms và cập nhật bộ đếm.            |
| `data-sensor.html`    | Dữ liệu cảm biến mẫu, menu chọn cảm biến hoặc Thời gian và nút Filter/Clear all.           |
| `action-history.html` | 6 cột lịch sử gồm người điều khiển, mã Device/Action/Status và phạm vi tìm kiếm thời gian. |
| `tables.js`           | Chuẩn hóa từ khóa, chọn phạm vi tìm kiếm theo trang, kết hợp bộ lọc và xử lý kết quả rỗng. |
| `profile.html`        | Avatar, phần căn giữa, tên/mã sinh viên và các tài nguyên dự án.                           |

Nên đọc `index.html` trước để thấy cấu trúc, rồi đối chiếu tên class với CSS. Sau đó đọc `dashboard.js` và `tables.js` theo các bước đã được ghi chú. Các thuộc tính `data-*` là điểm nối giữa HTML và JavaScript; class chủ yếu là điểm nối giữa HTML và CSS.

Ví dụ trong bảng lịch sử: chọn Device là Light, Action là Turn OFF, Status là Failed và nhập `10:31`, rồi bấm Find. JavaScript giữ những dòng có `data-device="light"`, `data-action="off"`, `data-status="failed"` đồng thời thời gian chứa `10:31`. Chọn Air Condition sẽ đối chiếu mã `data-device="ac"`. `data-search-scope="time"` trên vùng main giới hạn ô tìm kiếm vào cột `td.time`, nên tên thiết bị/người điều khiển không được tìm qua ô này.

Khi thêm một dòng mẫu, giữ đúng thứ tự các cột và điền thuộc tính `data-*` tương ứng. Khi sửa loại thiết bị, hành động hoặc trạng thái, sửa cả mã dữ liệu lẫn chữ hiển thị của dòng. Các dòng được đọc khi mở trang, nên tải lại trang sau khi sửa file HTML.

Để đổi độ trễ thiết bị, sửa số `500` ở cuối lời gọi `setTimeout` trong `dashboard.js`. Thời gian quay/luồng gió/tia sáng nằm ở các thuộc tính `animation` trong `dashboard.css`; đây là tốc độ hiệu ứng, tách riêng với thời gian xử lý công tắc.

## Xuất lại Figma

Chạy `npm.cmd run export:figma` để tạo lại 5 file trong `figma-export`, gồm 4 tab và trang đăng nhập. Các bản này nhúng CSS/JS và dùng dữ liệu mẫu, không chứa tài khoản MQTT hoặc mã kết nối phần cứng. Form đăng nhập trong bản xuất bị vô hiệu hóa và không gửi mật khẩu.
