VOXA — GEÇMİŞ YÜKLENİYOR / YÖNETİM PANELİ / TARAYICI FIX

Dosyalar: index.html, worker.js

Bu güncellemede:
- Mesaj geçmişi isteği artık izinsiz kanalda sessizce beklemiyor; kullanıcıya erişim hatası gösteriyor.
- Geçmiş isteğine 8 saniye içinde cevap gelmezse sonsuz “Geçmiş yükleniyor…” ekranı yerine anlaşılır bağlantı/Worker hata mesajı gösteriliyor.
- Mevcut uygulama özellikleri ve admin paneli kodu korunmuştur.
- JS sözdizimi kontrolü yapıldı.

CLOUDflare yayınlama:
1. Önce mevcut index.html ve worker.js dosyalarını yedekle.
2. ZIP içindeki index.html ve worker.js dosyalarını projedeki karşılıklarıyla değiştir.
3. Cloudflare Worker/Pages projesini yeniden deploy et.
4. Worker'ın Durable Object binding adı MERKEZ (Hub sınıfı) ve /ws ile /auth/* yolları doğru Worker'a yönlenmiş olmalı. Projenin mevcut wrangler/binding ayarlarını silme.
5. Mesaj geçmişi hâlâ yüklenmiyorsa, bu arayüzden ziyade deploy/binding/izin/veri depolama sorunu olabilir; ekrandaki yeni hata mesajını kontrol et.

YÖNETİCİ PANELİ:
- Yönetim paneli sadece ME.admin=true olan hesaplarda görünür.
- Bu Worker'da ana yönetici adı voxaadmin olarak tanımlıdır. İlk kayıt için Cloudflare Worker ortam değişkeni/secret ADMIN_SETUP_KEY yapılandırılmış olmalı ve kayıt ekranında kurulum anahtarı kullanılmalı. Normal bir hesabı otomatik olarak admin yapmak güvenlik nedeniyle yapılmaz.

TARAYICI/CIHAZ:
- Arayüz responsive ve HTTPS üzerinde kullanılmalıdır. Mikrofon/kamera için tarayıcı izinleri gerekir.
- Sözdizimi kontrolü yapıldı; canlı Cloudflare deploy ve farklı cihazlarda uçtan uca test yapılmadı. Her tarayıcıda %100 çalışma garantisi verilmez.
