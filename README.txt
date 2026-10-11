VOXA — HUB BAĞLANTISI DÜZELTMESİ

NEDEN:
Cloudflare ekran görüntünde Durable Object binding adı HUB görünüyor. Önceki worker.js kodu ise env.MERKEZ adını kullanıyordu. Bu isim uyuşmazlığı /ws bağlantısının kurulmasını engelleyebilir.

BU PAKETTE:
- worker.js: mevcut HUB binding adıyla eşleştirildi.
- _worker.js: aynı isim düzeltmesi yapıldı (yalnızca Pages Advanced Mode kullanıyorsan gerekir).
- index.html: bağlantı durumu/hata ekranı bulunan arayüz.

ÖNEMLİ — HANGİ DOSYAYI KULLANMALI:
Cloudflare ekranında Build command yok ve Deploy command `npx wrangler deploy` olduğu için büyük olasılıkla normal Worker dağıtımı kullanıyorsun. Bu durumda GitHub deposundaki worker.js dosyasını bu paketteki worker.js ile değiştir; index.html'i de mevcut projendeki aynı konumda güncel tut. _worker.js dosyasını ayrıca deploy etme; o sadece Pages Advanced Mode içindir.

YAYINLAMA:
1. ZIP'i indir ve aç.
2. GitHub'da bburakk65/Voxa deposunu aç.
3. worker.js dosyasını paketteki worker.js içeriğiyle değiştir (Edit > tüm kodu değiştir > Commit changes). Mobilde zor gelirse bilgisayarda yapmak daha kolaydır.
4. index.html dosyasını da pakettekine göre güncelle; depo yapın index.html kullanıyorsa mevcut dosyanın üzerine koy.
5. Cloudflare'ın GitHub üzerinden otomatik deploy etmesini bekle; tamamlanınca https://voxa.voxaweb.workers.dev adresini yenile.

GÜVENLİK / VERİ:
- HUB Durable Object binding'ini silme veya yeni bir namespace oluşturma; mevcut verilerin korunması için aynı namespace kullanılmalı.
- DISCORD_SECRET sırrını silme/değiştirme.
- Bu dosyalar düzeltilmiş olsa da canlı deploy ve cihazlar arası test bu ortamdan yapılamadı.
