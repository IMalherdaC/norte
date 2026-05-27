# 🧭 Norte — Finanças Pessoais Inteligentes

> Plataforma web (PWA) de finanças pessoais para brasileiros.
> Unifica contas, cartões e investimentos com foco em privacidade, LGPD e contexto brasileiro (PIX, MEI, IR).

---

## ✨ Funcionalidades

| Módulo | Status |
|--------|--------|
| E01 — Autenticação (e-mail/senha, Google OAuth, 2FA TOTP, reset) | ✅ |
| E02 — Dashboard, carteiras, cartões, saldo consolidado | ✅ |
| E03 — Lançamentos (receita/despesa/transferência), parcelamento, recorrência | ✅ |
| E05 — Orçamentos (50/30/20, alertas 80%/100%, projeção linear) | ✅ |
| E06 — Metas & Sonhos (PMT com Selic, simulação de aportes) | ✅ |
| E07 — Investimentos (renda fixa/variável/FIIs, gráficos) | ✅ |
| E08 — Relatórios (fluxo de caixa, anomalias z-score, Health Score) | ✅ |
| E09 — Compartilhamento (casais, categorias granulares) | 🔜 |
| E13 — Modo MEI (PF vs PJ, DAS, reserva IRPF) | ✅ |
| LGPD — Exportação ZIP, exclusão com carência 30 dias | ✅ |
| PWA — Instalável, offline-first (Service Worker) | ✅ |

---

## 🏗️ Arquitetura

```
norte/
├── core/
│   ├── auth/           # Autenticação, OAuth, 2FA, LGPD
│   ├── email/          # Serviço de e-mail (SMTP/Nodemailer)
│   ├── events/         # Event Bus Pub/Sub (assíncrono)
│   └── security/       # Argon2id, AES-256-GCM, JWT, TOTP, CSRF
│
├── finances/
│   ├── budgets/        # Orçamentos, 50/30/20, alertas
│   ├── goals/          # Metas, PMT, simulação Selic
│   ├── investments/    # Posições manuais, alocação, evolução
│   ├── transactions/   # CQRS, importação OFX/CSV, parcelamento
│   └── wallets/        # Contas, carteiras, cartões, saldo ACID
│
├── reports/
│   └── analytics/      # Fluxo de caixa, anomalias, MEI, exportação
│
├── database/
│   ├── connection.js   # SQLite + transações ACID
│   ├── migrations/     # Schema SQL versionado
│   ├── repositories/   # CRUD puro (sem ORM)
│   └── seeds/          # Categorias padrão
│
├── server/
│   ├── middleware/     # Auth JWT, CSRF, rate-limit, headers
│   └── routes/         # REST API modular por domínio
│
├── ui/
│   ├── pages/          # HTML (auth, dashboard, investimentos, relatórios)
│   └── utils/          # Service Worker (PWA)
│
├── shared/
│   ├── constants/      # Categorias, limites, textos
│   ├── fp-utils/       # pipe, compose, curry, Ok/Err, PMT
│   └── validators/     # Validação funcional de entrada
│
└── tests/              # 98 testes unitários + integração
```

**Padrão arquitetural:** Monolito Modular (Modulith)
**Paradigma:** JavaScript Funcional Puro — zero classes, zero herança, imutabilidade total

---

## 🚀 Como rodar

### Pré-requisitos
- Node.js ≥ 18
- npm ≥ 9

### 1. Instalar dependências

```bash
cd norte
npm install
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
# Edite .env com seus valores reais
# Gere JWT_SECRET e ENCRYPTION_KEY conforme instruções no arquivo
```

### 3. Rodar o servidor

```bash
npm start
# ou em modo desenvolvimento (hot-reload):
npm run dev
```

Acesse: **http://localhost:3000**

### 4. Rodar testes

```bash
npm test
# Output esperado: 98 passed, 0 failed
```

---

## 🔐 Segurança

| Camada | Tecnologia |
|--------|-----------|
| Hash de senhas | Argon2id (64MB mem, 3 iter, 4 threads) |
| Criptografia de campos sensíveis | AES-256-GCM |
| Tokens de acesso | JWT HS256 (15 min) |
| Refresh tokens | JWT rotativos (30 dias, HttpOnly cookie) |
| 2FA | TOTP (Google Authenticator / Authy) |
| CSRF | Token duplo (header + cookie) |
| Brute-force | Rate limiter por IP + lockout após 5 tentativas |
| Headers | CSP, HSTS, X-Frame-Options, X-Content-Type-Options |
| SQL | Prepared statements — zero SQL raw |

---

## 📊 Stack Técnica

| Camada | Tecnologia |
|--------|-----------|
| Runtime | Node.js 20 |
| HTTP | Express 4 |
| Banco de dados | SQLite (better-sqlite3) — ACID |
| Frontend | HTML5 semântico + Tailwind CSS CDN + Chart.js |
| PWA | Service Worker + Web App Manifest |
| Segurança | Argon2 + otplib + jsonwebtoken |
| Testes | Jest (98 testes) |
| Paradigma | Functional Programming — zero OOP |

---

## 🧪 Testes

```bash
npm test

# Suítes:
# ✅ crypto.test.js        — Argon2id, AES-GCM, JWT, TOTP, CSRF
# ✅ validators.test.js    — Validação funcional
# ✅ fp-utils.test.js      — pipe, compose, curry, PMT, Ok/Err
# ✅ transaction.test.js   — Parcelamento, recorrência, split, undo
# ✅ budget.test.js        — Projeção, 50/30/20, score saúde
# ✅ goal.test.js          — PMT, simulação Selic, progresso
# ✅ analytics.test.js     — z-score, MEI, totais, segregação PF/PJ
# ✅ integration.db.test.js — ACID real (SQLite), user→wallet→tx→budget→goal

# Total: 98 testes, 0 falhas
```

---

## 🇧🇷 Contexto Brasileiro

- **PIX** — tag nativa em lançamentos
- **MEI** — modo especial: relatórios segregados PF vs PJ, provisão automática DAS + IRPF
- **Selic** — usada no cálculo de PMT para simulação de metas
- **LGPD** — exportação completa (JSON + CSV em ZIP) e exclusão com carência de 30 dias
- **50/30/20** — método de orçamento com valores em R$

---

## 📝 Decisões de Design

### Por que Monolito Modular?
Permite evolução segura para microserviços quando necessário, sem o overhead prematuro de múltiplos deploys. Cada módulo é isolado com interfaces limpas.

### Por que SQLite?
Para uma aplicação pessoal (usuário único ou pequeno grupo familiar), SQLite oferece ACID real, zero configuração, e performance excelente (200k+ writes/seg). A migração para Postgres é trivial — os repositórios usam SQL padrão ANSI.

### Por que Functional Programming?
- Funções puras são testáveis sem mocks
- Imutabilidade elimina bugs de estado
- Composição (`pipe`/`compose`) é mais legível que herança
- SOLID via funções: cada função tem uma responsabilidade

---

## 🗺️ Roadmap

- [ ] Importação OFX/CSV/PDF com deduplicação por hash
- [ ] Notificações push (Service Worker + VAPID)
- [ ] Compartilhamento entre cônjuges (multi-user granular)
- [ ] Integração API do BCB (Selic, IPCA em tempo real)
- [ ] App mobile (React Native com o mesmo backend)
- [ ] Exportação PDF de relatórios (puppeteer)

---

*Feito com ☕ e JavaScript funcional puro — zero classes, zero herança, máximo cuidado.*
