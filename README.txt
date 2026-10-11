VOXA — BAĞLANTI + AYNI DOMAIN + ADMIN DÜZELTMESİ

PAKET İÇERİĞİ
- index.html: bağlantı durumunu açıkça gösteren arayüz
- _worker.js: Cloudflare Pages Advanced Mode giriş noktası; /ws ve /auth isteklerini Durable Object'e iletir, geri kalan GET isteklerinde Pages ASSETS dosyalarını sunar
- worker.js: normal Cloudflare Worker dağıtımı için API Worker dosyası (Pages Advanced Mode kullanıyorsan _worker.js dosyasını kullan)

ÖNEMLİ: Bu paket tek başına canlı siteye yüklenmiş değildir. Aynı hesap/mesajların tarayıcılar arasında eşitlenmesi için bütün tarayıcılar aynı yayınlanmış domain ve aynı Durable Object namespace'ine bağlanmalıdır.

CLOUDFLARE PAGES KULLANIYORSAN
1. Pages projesinin Build output directory/çıktı klasörüne index.html ve _worker.js koy. Advanced Mode için _worker.js, yayınlanan çıktı klasörünün kökünde olmalı.
2. Pages projesine Durable Object binding ekle: binding adı MERKEZ, class name Hub. Var olan Durable Object namespace'ini kullan; yeni/boş bir namespace oluşturursan eski hesap ve mesajlar orada görünmez.
3. Worker/Pages ortam değişkeni olarak DISCORD_SECRET tanımla (en az 32 karakterlik rastgele gizli değer). Ana yönetici ilk kaydı için ADMIN_SETUP_KEY secret'ı da tanımla.
4. _worker.js içindeki Hub class'ının Durable Object migration/namespace ayarının mevcut namespace ile eşleştiğini kontrol et. Var olan namespace'i silme veya değiştirme.
5. Deploy et. Aynı site adresini farklı tarayıcıda açıp aynı kullanıcıyla giriş yap. Bağlantı başarısızsa artık alt kısımda sebebi kontrol etmeyi söyleyen durum mesajı görünür.

NORMAL CLOUDFLARE WORKER + PAGES AYRI KULLANIYORSAN
- index.html'in geldiği domain üzerinde /ws ve /auth/* yolları bu worker'a route edilmelidir. Worker'ın MERKEZ binding'i ve secrets'ı doğru olmalı.
- Başka bir domain kullanıyorsan yalnızca HTML'i taşımak yeterli değildir; /ws ve /auth aynı backend'e gitmelidir.

ADMIN
- Admin simgesi yalnızca sunucu hesabı admin yetkisini verdiğinde görünür.
- Ana yönetici adı voxaadmin. İlk kayıtta ADMIN_SETUP_KEY gerekir. Normal hesabı tarayıcıdan admin yapacak bir istemci kısayolu eklenmedi; yetki sunucuda tutulur ve aynı backend'e bağlanan tüm tarayıcılara gelir.

DOĞRULAMA
- JS sözdizimi kontrolü yapılmalıdır; canlı Cloudflare deploy/test bu paketten yapılamaz.
- WebRTC kamera/mikrofon için HTTPS ve tarayıcı izinleri gerekir.
