VOXA — ÇOK CİHAZLI / ÇOK TARAYICILI SÜRÜM

Dosyalar:
- index.html: mobil/tablet/PC uyumlu web arayüzü
- worker.js: ortak hesaplar, kayıtlı kullanıcı listesi, çevrimiçi durum ve WebSocket sunucusu

Hedef kullanım:
- Android/iPhone, tablet, Windows/macOS/Linux bilgisayar
- Chrome, Opera, Yandex Browser, Edge, Firefox ve Safari'nin güncel sürümleri
- Uygulama kurmadan aynı HTTPS site bağlantısından giriş
- Aynı sunucu tarafı verisi: hesaplar, mesajlar ve çevrimiçi/çevrimdışı kullanıcı listesi

CLOUDflare'a yayınlama:
1. Önce çalışan projenin yedeğini al.
2. Bu paketteki index.html ve worker.js dosyalarını projenin karşılıklarıyla değiştir.
3. Worker ayarlarında Durable Object binding adı MERKEZ olmalı ve Hub sınıfına bağlanmalı.
4. /ws ve /auth/* isteklerinin aynı Worker'a yönlendiğini kontrol et.
5. Gerekli mevcut secret'ları (özellikle DISCORD_SECRET ve kurulumda kullanılıyorsa ADMIN_SETUP_KEY) koru; değerleri silme.
6. Worker ve Pages/siteyi yayınla. Siteyi HTTPS adresinden aç.
7. İki farklı cihaz ve farklı tarayıcıda ayrı hesaplarla giriş yaparak mesaj, üye durumu ve ses/görüntü izinlerini test et.

Tarayıcı notları:
- Ses/kamera için HTTPS ve kullanıcının mikrofon/kamera izni gerekir.
- Safari/iOS ve bazı mobil tarayıcılarda arka planda çalışma ve otomatik ses oynatma kısıtlanabilir.
- Güncel tarayıcılar hedeflenmiştir; tüm sürümlerde yüzde 100 aynı davranış garanti edilemez.

Kontrol durumu:
- JavaScript sözdizimi ve ZIP bütünlüğü kontrol edilebilir; bu paket canlı Cloudflare'a otomatik yüklenmez.
- Canlı deploy ve iki/çok cihazlı uçtan uca test henüz yapılmış sayılmaz. Gerçek çalışması için Cloudflare Durable Object binding, yönlendirme ve secret ayarlarının doğru olması gerekir.
