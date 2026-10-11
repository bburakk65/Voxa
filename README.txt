VOXA — DM / Sesli / Görüntülü Görüşme Fix paketi

Dosyalar:
- index.html
- worker.js

Yükleme:
1. Projedeki mevcut index.html ve worker.js dosyalarının yedeğini al.
2. Bu ZIP içindeki iki dosyayı projenin kök dizinindeki karşılıklarıyla değiştir.
3. Cloudflare Workers/Pages dağıtımını yeniden yayınla.
4. İki ayrı cihaz/tarayıcıyla giriş yapıp önce DM mesajını, sonra özel aramayı test et. Grup görüşmesi için 3 cihaz kullan.

Bu pakette yapılan kod düzeltmeleri:
- Yeni biri ses odasına katılınca odadaki tüm oturumlara güncel peer listesi gönderilir; böylece eski katılımcılar yeni katılımcı için bağlantı başlatabilir.
- Ses alımı otomatik oynatma engeline takılırsa kullanıcı etkileşiminden sonra tekrar oynatmayı dener.
- Mevcut offer çakışmasını azaltan tek taraflı teklif başlatma davranışı korunur.

Önemli: JavaScript sözdizimi kontrol edildi. Gerçek telefonlar, farklı ağlar ve canlı Cloudflare dağıtımı üzerinde uçtan uca test yapılmış değildir; kamera/mikrofon izinleri, HTTPS ve ağ/NAT koşulları sonucu etkileyebilir.
