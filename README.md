# IoT Control

Giao diện HTML/CSS theo 4 ảnh tham khảo, dùng JavaScript thuần cho tìm kiếm và bộ lọc, không sử dụng framework hay thư viện bên ngoài.

## Mở giao diện

Mở `index.html` trực tiếp trong trình duyệt. Sidebar dẫn đến các trang:

- `index.html`: Dashboard, thẻ cảm biến, biểu đồ SVG và công tắc quạt, điều hòa, đèn.
- `data-sensor.html`: Bảng dữ liệu cảm biến mẫu.
- `action-history.html`: Bảng lịch sử điều khiển mẫu.
- `profile.html`: Thông tin sinh viên và tài nguyên dự án.

Tất cả trang dùng chung `styles.css`, có bố cục thích ứng với điện thoại và máy tính. Dashboard dùng thêm `dashboard.css` và `dashboard.js` để hiển thị giao diện và cập nhật số thiết bị đang bật. Data Sensor và Action History dùng chung `tables.js`; hoạt động khi mở file HTML trực tiếp, không cần server.

## Phạm vi chức năng

Điều hướng hoạt động qua liên kết HTML. Dashboard có đúng 3 thiết bị: quạt, điều hòa và đèn. Công tắc dùng checkbox và CSS để đổi trạng thái trên giao diện, không điều khiển thiết bị thực và không lưu trạng thái khi tải lại. Quạt quay, điều hòa có hiệu ứng luồng gió và đèn có hiệu ứng ánh sáng khi bật; các hiệu ứng dừng khi tắt và tự tắt khi người dùng bật tùy chọn giảm chuyển động của hệ điều hành. Số thiết bị đang bật cập nhật theo công tắc. Nút `?` mở hướng dẫn bằng phần tử HTML `details`.

Mỗi thao tác bật/tắt có độ trễ mô phỏng 500ms. Trong lúc chờ, thiết bị hiển thị **Đang xử lý…** và công tắc đó tạm khóa; trạng thái, hiệu ứng và bộ đếm chỉ cập nhật khi hoàn tất. Các thiết bị khác vẫn có thể được điều khiển độc lập.

Dữ liệu và biểu đồ là mẫu tĩnh. Nhập từ khóa hoặc chọn bộ lọc, rồi bấm **Find** (hoặc nhấn **Enter** trong ô tìm kiếm) để áp dụng điều kiện. Bảng giữ kết quả hiện tại cho đến khi xác nhận. Phạm vi tìm kiếm khác nhau theo trang:

- Data Sensor: chọn Sensor ở bên trái, rồi nhập thông tin vào ô tìm kiếm ngay bên cạnh. Tìm trên ID, loại cảm biến, giá trị, đơn vị và giờ của những dòng thuộc sensor đã chọn. All Sensors cho phép tìm ở mọi sensor.
- Action History: chỉ tìm cột thời gian (TIME), có thể nhập đầy đủ `10:31:15` hoặc một phần như `10:31`. Bảng có thêm cột **Người điều khiển**, hiện dùng Admin trong dữ liệu mẫu.

Tìm kiếm không phân biệt chữ hoa/thường, dấu tiếng Việt hoặc khoảng trắng thừa. Trong Data Sensor, nhiều từ có thể nằm ở các cột khác nhau; ví dụ chọn Humidity rồi nhập `65 %` để tìm giá trị độ ẩm. Tìm kiếm kết hợp với các bộ lọc:

- Data Sensor: loại cảm biến. Có thể nhập giá trị hoặc đơn vị vào ô tìm kiếm.
- Action History: Device (Light, Fan, Air Condition), Action và Status (Success/Failed).

Chọn All Sensors hoặc All Statuses để bỏ điều kiện lọc tương ứng, rồi bấm Find. Xóa từ khóa và bấm Find để khôi phục các dòng phù hợp với bộ lọc đang chọn. Số dòng cập nhật theo kết quả; khi không có kết quả, bảng hiển thị thông báo.

Nút **Clear all** trên Data Sensor và Action History xóa từ khóa tìm kiếm, đặt tất cả bộ lọc của trang về All và hiển thị lại toàn bộ dữ liệu.

Dữ liệu mẫu hiện có 8 dòng cảm biến và 9 dòng lịch sử, gồm 2 bản ghi điều hòa. Phân trang chưa được triển khai; các nút chuyển trang bị vô hiệu hóa. Các nút tài nguyên cũng bị vô hiệu hóa vì chưa có đường dẫn dự án.

Thay `[HỌ VÀ TÊN]`, `[MÃ SINH VIÊN]` trong `profile.html` bằng thông tin của bạn. Khi có URL Github, Figma, Postman và PDF, thay nút tương ứng bằng liên kết `<a href="URL">Open</a>` và thêm CSS cho liên kết nếu cần.

## Kiểm tra

Chạy `node --test tests/dashboard.test.cjs tests/table-search.test.cjs` để kiểm tra độ trễ điều khiển thiết bị, tìm kiếm theo sensor, tìm riêng thời gian trong lịch sử, bộ lọc điều hòa, xử lý kết quả rỗng và xóa từ khóa. Các kiểm tra dùng dữ liệu đọc từ HTML và mô phỏng DOM, không cần cài thư viện.

## Định dạng mã

HTML được xuống dòng theo từng phần tử; CSS có mỗi thuộc tính trên một dòng. Tất cả file dùng UTF-8, thụt lề 2 khoảng trắng và xuống dòng LF. Các khối chính có chú thích để dễ tìm và chỉnh sửa.

`.editorconfig` và `.prettierrc.json` lưu quy tắc định dạng chung. Để định dạng lại sau khi sửa, chạy:

```powershell
npx --yes prettier@3 --write "*.html" "*.css" "*.js" "tests/*.cjs"
```

Prettier chỉ dùng khi định dạng mã; mở web không cần cài công cụ này.

## Cách đọc và chỉnh sửa mã

Các file HTML, CSS và JavaScript có chú thích tiếng Việt ngay cạnh phần liên quan. Chú thích HTML dùng `<!-- ... -->`, CSS dùng `/* ... */`, JavaScript dùng `// ...` hoặc `/* ... */`; các chú thích này không hiển thị thành nội dung trên trang.

| File | Nội dung cần đọc |
| --- | --- |
| `index.html` | Cấu trúc Dashboard, thẻ cảm biến, biểu đồ SVG và 3 công tắc. |
| `styles.css` | Màu chung, sidebar, bảng, hồ sơ, Flexbox/Grid và bố cục theo màn hình. |
| `dashboard.css` | Kiểu riêng Dashboard, cánh quạt quay, luồng gió, tia sáng và vòng chờ. |
| `dashboard.js` | Sự kiện công tắc, trạng thái đã áp dụng, khóa khi chờ 500ms và cập nhật bộ đếm. |
| `data-sensor.html` | Dữ liệu cảm biến mẫu, bộ lọc loại cảm biến và nơi đặt nút Find/Clear all. |
| `action-history.html` | 6 cột lịch sử gồm người điều khiển, mã Device/Action/Status và phạm vi tìm kiếm thời gian. |
| `tables.js` | Chuẩn hóa từ khóa, chọn phạm vi tìm kiếm theo trang, kết hợp bộ lọc và xử lý kết quả rỗng. |
| `profile.html` | Avatar, phần căn giữa, tên/mã sinh viên và các tài nguyên dự án. |

Nên đọc `index.html` trước để thấy cấu trúc, rồi đối chiếu tên class với CSS. Sau đó đọc `dashboard.js` và `tables.js` theo các bước đã được ghi chú. Các thuộc tính `data-*` là điểm nối giữa HTML và JavaScript; class chủ yếu là điểm nối giữa HTML và CSS.

Ví dụ trong bảng lịch sử: chọn Device là Light, Action là Turn OFF, Status là Failed và nhập `10:31`, rồi bấm Find. JavaScript giữ những dòng có `data-device="light"`, `data-action="off"`, `data-status="failed"` đồng thời thời gian chứa `10:31`. Chọn Air Condition sẽ đối chiếu mã `data-device="ac"`. `data-search-scope="time"` trên vùng main giới hạn ô tìm kiếm vào cột `td.time`, nên tên thiết bị/người điều khiển không được tìm qua ô này.

Khi thêm một dòng mẫu, giữ đúng thứ tự các cột và điền thuộc tính `data-*` tương ứng. Khi sửa loại thiết bị, hành động hoặc trạng thái, sửa cả mã dữ liệu lẫn chữ hiển thị của dòng. Các dòng được đọc khi mở trang, nên tải lại trang sau khi sửa file HTML.

Để đổi độ trễ thiết bị, sửa số `500` ở cuối lời gọi `setTimeout` trong `dashboard.js`. Thời gian quay/luồng gió/tia sáng nằm ở các thuộc tính `animation` trong `dashboard.css`; đây là tốc độ hiệu ứng, tách riêng với thời gian xử lý công tắc.
