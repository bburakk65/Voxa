# Voxa — Android + Masaüstü yayın kılavuzu

Bu klasördeki her şey GitHub Actions ile otomatik derlenir.

## Bir kerelik kurulum (telefondan)
1. GitHub'da depo > Add file > Create new file > adı: `.github/workflows/voxa-yayin.yml` > `voxa-yayin.yml` içeriğini yapıştır > Commit.
2. Depo > Settings > Secrets and variables > Actions > New repository secret: Ad `KEYSTORE_PASSWORD`, değer en az 16 karakterlik uzun bir şifre. **Bu şifreyi güvenli bir yere yaz; kaybolursa uygulama güncellemeleri kurulamaz.**
3. Depo > Add file > Upload files > `voxa-paket.zip` > Commit. Otomasyon zip'i açar, derler ve yayımlar.
4. Actions sekmesinde "Voxa Yayın" çalışır (Android ~10 dk, masaüstü ~15 dk). Bitince Releases sekmesinde dosyalar görünür.

## Güncelleme
- `android/` ya da `desktop/` altındaki bir dosya GitHub'a gönderilince otomatik yeni sürüm çıkar (sürüm: `1.0.<çalıştırma no>`).
- Uygulamalar `version.json` ile yeni sürümü algılar.
- Sorunlu sürüm yayımlanırsa: Releases'ta o sürümü "Delete" et (bir önceki kararlı sürüm yeniden "latest" olur) ve Actions > Voxa Yayın > Run workflow ile düzeltilmiş kodu yeniden yayımla.
- Eski bir kodla yeni (daha yüksek numaralı) sürüm çıkarmak için Run workflow'da `ref` alanına eski commit adresini yaz.

## İmza anahtarı
İlk çalıştırmada anahtar otomatik üretilir ve AES-256 ile şifrelenmiş olarak `anahtar` dalına kaydedilir. Şifresi yalnızca GitHub Secrets'taki `KEYSTORE_PASSWORD`'dür. Aynı anahtar her sürümde kullanılır; paket kimliği `com.voxa.app`.
