VOXA — Admin Paneli / Gerçek Cloudflare Durable Object sunucu düzeltmesi

Dosyalar:
- index.html
- worker.js

Yapılanlar:
- Admin paneli kullanıcı listesine Tümü / Çevrimiçi / Çevrimdışı filtreleri ve Yenile düğmesi eklendi.
- Kullanıcı listesi sunucudaki kayıtlı hesaplardan alınır; çevrimdışı hesaplar da listede kalır.
- Worker içindeki Durable Object binding çağrıları HUB yerine MERKEZ olarak düzeltildi. Bu paket, mevcut Cloudflare binding adının MERKEZ olduğu yapılandırmayı bekler.
- JavaScript sözdizimi kontrolleri yapıldı.

Cloudflare kurulum notu:
1. Önce mevcut dosyaların yedeğini al.
2. index.html ve worker.js dosyalarını projendeki karşılıklarıyla değiştir.
3. Cloudflare Worker ayarlarında Durable Object binding adı MERKEZ olmalı ve Hub sınıfına bağlı olmalı. Projende binding adı farklıysa, kod ve Cloudflare ayarı aynı adı kullanmalı.
4. Pages/Worker deploy ayarlarında /ws ve /auth/* isteklerinin bu Worker'a ulaştığını doğrula.
5. İlk yönetici kurulumu gerekiyorsa ADMIN_SETUP_KEY secret'ı ve diğer mevcut auth secret'larını silme/değiştirme.
6. Deploy sonrası iki ayrı cihazdan hesap aç/giriş yap; admin panelinde kullanıcıların hem çevrimiçi hem çevrimdışı filtrelerini test et.

Önemli sınırlar:
- Bu ZIP canlı Cloudflare'a kendiliğinden yükleme yapmaz.
- Sözdizimi kontrolü ve kaynak kod incelemesi yapıldı; canlı deploy, gerçek hesaplarla uçtan uca test ve kalıcı depolama doğrulaması yapılmadı.
- Gerçek kalıcı sunucu için Cloudflare Durable Object binding ve yönlendirme ayarları da doğru olmalıdır. Yalnızca HTML dosyasını değiştirmek yeterli değildir.
