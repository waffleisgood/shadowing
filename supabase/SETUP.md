# Supabase 설정 가이드 (로그인 + 동기화)

사이트 주소: https://koreanwaffle.com/

## 1. 프로젝트 만들기 (5분)
1. https://supabase.com 에 가입한 뒤 **New project**를 누릅니다. Region은 `Frankfurt (eu-central-1)`처럼 사용자와 가까운 곳으로 고릅니다.
2. 왼쪽 **SQL Editor**에서 `supabase/schema.sql` 내용을 붙여 넣고 **Run**을 누릅니다. 테이블 2개와 RLS 정책이 만들어집니다.
3. **Project Settings → API**에서 두 값을 복사해 `site/config.js`에 넣습니다.
   - `Project URL` → `supabaseUrl`
   - `anon public` 키 → `supabaseAnonKey`
   - anon 키는 공개되어도 괜찮습니다. 각자 자기 데이터만 접근할 수 있도록 RLS가 막아 줍니다. 단, **`service_role` 키는 절대 넣으면 안 됩니다.**

## 2. 로그인 주소 설정
**Authentication → URL Configuration**에서 아래 두 항목을 설정합니다.
- Site URL: `https://koreanwaffle.com/`
- Redirect URLs에 다음을 추가합니다.
  - `https://koreanwaffle.com/shadowing/`
  - `https://koreanwaffle.com/shadowing/pouch.html`
  - `http://localhost:8000/` (로컬 테스트용)

## 3. 이메일 로그인 (기본, 추가 설정 없음)
- **Authentication → Providers → Email**은 기본으로 켜져 있습니다.
- 매직 링크를 쓰므로 비밀번호가 필요 없습니다.
- 메일 제목과 본문은 **Authentication → Email Templates → Magic Link**에서 한국어로 바꿀 수 있습니다.
- 주의: Supabase 기본 메일 서버는 **시간당 발송 수가 아주 적습니다.** 사용자가 늘면 **SMTP 설정**에서 Resend, SendGrid 같은 메일 서비스를 연결하세요.

## 4. Google 로그인 (무료, 약 15분)
1. https://console.cloud.google.com 에서 프로젝트를 만듭니다.
2. **APIs & Services → OAuth consent screen**을 설정합니다.
   - 앱 이름: Korean Waffle
   - 지원 이메일을 입력하고, 범위는 `email`, `profile`만 추가합니다.
   - 게시 상태를 **In production**으로 바꿉니다. 테스트 상태로 두면 등록한 테스트 사용자만 로그인할 수 있습니다.
3. **Credentials → Create credentials → OAuth client ID**를 누릅니다.
   - 유형: Web application
   - Authorized redirect URIs에 Supabase의 **Authentication → Providers → Google** 화면에 표시된 Callback URL을 넣습니다. 형식은 `https://<project>.supabase.co/auth/v1/callback`입니다.
4. 발급된 Client ID와 Client Secret을 Supabase **Providers → Google**에 넣고 Enable합니다.
5. `site/config.js`에서 `enableGoogle: true`로 바꿉니다.

## 5. Apple 로그인 (유료 계정 필요)
- **Apple Developer Program**에 가입해야 합니다. 연 $99입니다.
1. developer.apple.com → Certificates, IDs & Profiles로 갑니다.
2. App ID를 만들고 **Sign in with Apple**을 체크합니다.
3. **Services ID**를 만듭니다. 웹 로그인에 쓰는 ID입니다.
   - Domains: `<project>.supabase.co`
   - Return URL: Supabase가 안내하는 Callback URL
4. **Keys**에서 Sign in with Apple 키(.p8)를 만듭니다.
5. Supabase **Providers → Apple**에 Services ID, Team ID, Key ID, .p8 키를 넣습니다.
   - Apple 웹 로그인용 client secret은 **6개월마다 갱신**해야 합니다. Supabase 안내에 따라 다시 생성합니다.
6. `site/config.js`에서 `enableApple: true`로 바꿉니다.

## 6. 반영
```bash
cd /Users/leeyein/korean_waffle/shadowing_dot_com/site
git add config.js && git commit -m "Enable Supabase login" && git push
```

## 동작 방식
- 로그인하지 않으면 지금처럼 이 브라우저에만 저장합니다.
- 처음 로그인하면 이 브라우저의 주머니와 진도를 계정으로 옮깁니다. 그 뒤로는 모든 기기에서 같은 데이터를 봅니다.
- 같은 표현을 여러 기기에서 고친 경우 더 최근에 고친 내용을 남깁니다. 주머니에서 뺀 표현은 다른 기기에서도 빠집니다.
- 로그아웃하면 이 기기에 남은 데이터를 지웁니다. 공용 PC를 고려한 동작이며, 다시 로그인하면 복원됩니다.
- 계정을 삭제하면 해당 사용자의 데이터도 함께 삭제됩니다(`on delete cascade`).
