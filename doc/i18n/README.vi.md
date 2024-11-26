<h3 align="center"><img width="80" alt="Puter.com, Máy Tính Đám Mây Cá Nhân: Tất cả các tệp, ứng dụng, và trò chơi của bạn ở một nơi, có thể truy cập từ bất cứ đâu vào bất kỳ lúc nào." src="https://assets.puter.site/puter-logo.png"></h3>
<h3 align="center">Hệ điều hành Internet! Miễn phí, Mã nguồn mở và Có thể tự lưu trữ.</h3>
<p align="center">
    <img alt="Kích thước repo GitHub" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="Phiên bản phát hành GitHub" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=Phi%C3%AAn%20b%E1%BA%A3n%20ph%C3%A1t%20h%C3%A0nh%20GitHub"> <img alt="Giấy phép GitHub" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« DEMO TRỰC TIẾP »</strong></a>
    <br />
    <br />
    <a href="https://puter.com">Puter.com</a>
    ·
    <a href="https://docs.puter.com" target="_blank">SDK</a>
    ·
    <a href="https://discord.com/invite/PQcx7Teh8u">Discord</a>
    ·
    <a href="https://reddit.com/r/puter">Reddit</a>
    ·
    <a href="https://twitter.com/HeyPuter">X (Twitter)</a>
</p>

<h3 align="center"><img width="800" style="border-radius:5px;" alt="chụp màn hình" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## Puter

Puter là một hệ điều hành internet tiên tiến, mã nguồn mở được thiết kế để có nhiều tính năng, tốc độ vượt trội và khả năng mở rộng cao. Puter có thể được sử dụng như:

- Một đám mây cá nhân ưu tiên quyền riêng tư để lưu trữ tất cả các tệp, ứng dụng và trò chơi của bạn ở một nơi an toàn, có thể truy cập từ bất cứ đâu, bất cứ lúc nào.
- Một nền tảng để xây dựng và xuất bản các trang web, ứng dụng web và trò chơi.
- Một sự thay thế cho Dropbox, Google Drive, OneDrive, v.v. với giao diện mới mẻ và nhiều tính năng mạnh mẽ.
- Một môi trường máy tính từ xa cho các máy chủ và máy trạm.
- Một dự án thân thiện, mã nguồn mở và cộng đồng để học hỏi về phát triển web, điện toán đám mây, hệ thống phân tán và nhiều hơn nữa!

<br/>

## Bắt Đầu

## 💻 Phát Triển Cục Bộ

```bash
Copy code
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```
Điều này sẽ khởi chạy Puter tại http://puter.localhost:4100 (hoặc cổng kế tiếp có sẵn).

<br/>

### 🐳 Docker


```bash
Copy code
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter  ghcr.io/heyputer/puter
```

<br/>

## 🐙 Docker Compose

## Linux/macOS

``` bash
Copy code
mkdir -p puter/config puter/data
sudo chown -R 1000:1000 puter
wget https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml
docker compose up
```

<br/>

## Windows

```powershell
Copy code
mkdir -p puter
cd puter
New-Item -Path "puter\config" -ItemType Directory -Force
New-Item -Path "puter\data" -ItemType Directory -Force
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml" -OutFile "docker-compose.yml"
docker compose up
```
<br/>

## ☁️ Puter.com

Puter có sẵn dưới dạng dịch vụ lưu trữ tại [**puter.com**](https://puter.com).

<br/>

## Yêu Cầu Hệ Thống

- **Hệ Điều Hành:** Linux, macOS, Windows
- **RAM:** Tối thiểu 2GB (Khuyến nghị 4GB)
- **Dung Lượng Ổ Cứng:** Còn trống 1GB
- **Node.js:** Phiên bản 16+ (Khuyến nghị phiên bản 22+)
- **npm:** Phiên bản ổn định mới nhất

<br/>

## Hỗ Trợ

Kết nối với các nhà bảo trì và cộng đồng thông qua các kênh sau:

- Báo cáo lỗi hoặc yêu cầu tính năng? Vui lòng mở một vấn đề.
- Discord: discord.com/invite/PQcx7Teh8u
- X (Twitter): x.com/HeyPuter
- Reddit: reddit.com/r/puter/
- Mastodon: mastodon.social/@puter
- Vấn đề bảo mật? security@puter.com
- Email các nhà bảo trì tại hi@puter.com

Chúng tôi luôn sẵn sàng giúp đỡ bạn với bất kỳ câu hỏi nào bạn có. Đừng ngần ngại hỏi!

<br/>

## Giấy Phép

Kho lưu trữ này, bao gồm tất cả nội dung, dự án con, mô-đun và thành phần của nó, được cấp phép theo [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt), trừ khi được tuyên bố rõ ràng khác. Các thư viện của bên thứ ba được bao gồm trong kho lưu trữ này có thể phải tuân theo các giấy phép riêng của chúng.

<br/>
