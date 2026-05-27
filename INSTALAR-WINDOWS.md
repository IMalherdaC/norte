# 🧭 Como instalar o Norte no Windows

## Pré-requisito: Node.js
Baixe e instale em: https://nodejs.org (botão LTS)

---

## Passo a passo (copie e cole no terminal)

### 1. Instalar ferramentas de build do Windows (UMA VEZ SÓ)
Abra o **PowerShell como Administrador** e rode:
```
npm install --global windows-build-tools
```
Se o comando acima der erro, use este alternativo:
```
npm install --global --production windows-build-tools
```

### 2. Instalar as dependências do projeto
Na pasta `norte`, rode:
```
npm install
```

### 3. Configurar o ambiente
```
copy .env.example .env
```
Abra o arquivo `.env` com o Bloco de Notas e preencha:
```
JWT_SECRET=qualquer-texto-longo-aqui-minimo-32-caracteres
ENCRYPTION_KEY=qualquer-texto-longo-aqui-minimo-64-caracteres-hex
```

### 4. Iniciar o servidor
```
npm start
```

### 5. Abrir no navegador
Acesse: http://localhost:3000

---

## ⚠️ Se aparecer erro do node-gyp / Visual Studio

O `better-sqlite3` precisa de ferramentas nativas. Execute:
```
npm install --global node-gyp
npm install --global --production windows-build-tools
```
Depois tente `npm install` novamente.

**Alternativa mais fácil:** Instale o [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) e marque a opção **"Desenvolvimento para desktop com C++"**.
