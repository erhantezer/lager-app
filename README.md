# LAGERROM — Özel depo yönetim sistemi

Next.js + Supabase ile fotoğraflı ürün kaydı, stok giriş/çıkış, işlem geçmişi ve 3–4 yetkili kullanıcı.

## Kurulum

1. Node.js 20+ yükleyin. Bu klasörde `npm install` çalıştırın.
2. [supabase.com](https://supabase.com) üzerinden yeni proje oluşturun.
3. Supabase > SQL Editor'da `supabase/schema.sql` dosyasını çalıştırın.
4. Supabase > Authentication > Providers > Email: **public signups kapalı** olacak şekilde yapılandırın. Uygulamada kayıt sayfası yoktur.
5. Supabase > Authentication > Users > **Add user** ile 3–4 kullanıcıyı oluşturun. Kullanıcıların e-posta adreslerini doğrulayın.
6. Her kullanıcının Supabase Auth UUID değerini alın. SQL Editor'da her kullanıcı için şu komutu çalıştırın:

   `insert into public.allowed_users(user_id,role) values ('AUTH_USER_UUID','admin');`

   İlk kullanıcı `admin`, diğerleri `member` olmalı. En fazla 4 kişi ekleyin (bu limit yönetimsel olarak uygulanır, veritabanında otomatik limit yoktur).
7. `.env.example` dosyasını `.env.local` adıyla kopyalayın. Supabase > Project Settings > API bölümündeki URL, publishable/anon key ve **secret service_role key** değerlerini doldurun. `SUPABASE_SERVICE_ROLE_KEY` asla tarayıcıya gönderilmemeli veya Git'e eklenmemeli.
8. `npm run dev` çalıştırın ve http://localhost:3000 adresini açın.
9. İnternetten erişim için Vercel'e deploy edin, aynı üç ortam değişkenini Vercel proje ayarlarında tanımlayın. Supabase ve Vercel bölge/planlarını ve veri koruma gereksinimlerini kontrol edin.

## Güvenlik notları

- API uçları Supabase access token doğrular ve `allowed_users` tablosundan yetki kontrolü yapar.
- Service-role yalnızca sunucu API uçlarında kullanılır; veritabanı tablolarında RLS etkindir.
- Fotoğraflar özel bucket'ta tutulur; görüntüleme bağlantıları 1 saat geçerlidir.
- Stok değişiklikleri veritabanında atomik RPC ile yapılır; eksi stok engellenir.
- Silme işlemi yalnızca admin içindir. Silinen ürünün hareket geçmişi de silinir; kalıcı denetim kaydı gerekiyorsa soft-delete uygulanmalıdır.
- İlk sürüm tek fotoğraf/ürün destekler. Yedekleme, çoklu fotoğraf, kullanıcı adı bazlı hareket raporu, şifre sıfırlama ve kapsamlı denetim günlükleri sonraki sürüme eklenebilir.
- Üretim öncesinde erişim ve güvenlik testleri yapın.

## Özellikler

- Ürün: isim, SKU, kategori, konum, açıklama, miktar, fotoğraf
- Arama, stok özeti, azalan stok göstergesi
- Stok giriş/çıkış ve not
- İşlem geçmişi
- Giriş yapan yetkili kullanıcılar

