/**
 * @module core/email/email.service
 * @description Serviço de e-mail com suporte a Resend (primário) e SMTP (fallback).
 * Todas as funções são puras — side-effects isolados em send().
 * Templates em português BR com microcopy amigável.
 */

'use strict';

// ─── Adapter selecionado em runtime pelo env ───
const createSendAdapter = () => {
  if (process.env.RESEND_API_KEY) {
    const { Resend } = require('resend');
    const resend     = new Resend(process.env.RESEND_API_KEY);
    return async ({ to, subject, html }) => {
      const { error } = await resend.emails.send({
        from:    process.env.EMAIL_FROM || 'Norte <noreply@norte.app>',
        to:      [to],
        subject,
        html,
      });
      if (error) throw new Error(`Resend error: ${error.message}`);
    };
  }

  if (process.env.SMTP_HOST) {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_PORT === '465',
      auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    return async ({ to, subject, html }) => {
      await transporter.sendMail({
        from:    process.env.EMAIL_FROM || '"Norte" <noreply@norte.app>',
        to, subject, html,
      });
    };
  }

  // Dev fallback: só loga
  return async ({ to, subject }) => {
    console.log(`[EMAIL DEV] Para: ${to} | Assunto: ${subject}`);
  };
};

const sendRaw = createSendAdapter();

// ─── Wrapper com tratamento de erro ───
const send = async (opts) => {
  try {
    await sendRaw(opts);
    return { ok: true };
  } catch (err) {
    console.error('[EMAIL ERROR]', err.message);
    return { ok: false, error: err.message };
  }
};

// ─── Layout base (compatível com clientes de e-mail) ───
const baseLayout = (content) => `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; background: #F9FAFB; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .wrapper { max-width: 560px; margin: 32px auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 8px rgba(0,0,0,.08); }
    .header  { background: linear-gradient(135deg, #6366F1, #8B5CF6); padding: 32px; text-align: center; }
    .header h1 { color: #fff; margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -0.5px; }
    .header p  { color: rgba(255,255,255,.8); margin: 4px 0 0; font-size: 14px; }
    .body    { padding: 32px; color: #374151; font-size: 15px; line-height: 1.6; }
    .btn     { display: inline-block; margin: 24px 0; padding: 14px 32px; background: #6366F1;
               color: #fff !important; text-decoration: none; border-radius: 10px;
               font-weight: 600; font-size: 15px; }
    .alert   { background: #FEF3C7; border-left: 4px solid #F59E0B; border-radius: 8px;
               padding: 14px 16px; margin: 20px 0; font-size: 14px; color: #92400E; }
    .code    { display: inline-block; font-family: monospace; font-size: 28px; font-weight: 700;
               letter-spacing: 8px; color: #6366F1; background: #EEF2FF;
               padding: 12px 24px; border-radius: 8px; margin: 16px 0; }
    .footer  { padding: 20px 32px; text-align: center; color: #9CA3AF; font-size: 12px;
               border-top: 1px solid #F3F4F6; }
    .table   { width: 100%; border-collapse: collapse; margin: 16px 0; }
    .table td { padding: 8px 12px; border-bottom: 1px solid #F3F4F6; font-size: 14px; }
    .table td:last-child { text-align: right; font-weight: 600; }
    @media (max-width: 600px) { .wrapper { margin: 0; border-radius: 0; } .body { padding: 20px; } }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>🧭 Norte</h1>
      <p>Finanças Pessoais Inteligentes</p>
    </div>
    <div class="body">${content}</div>
    <div class="footer">
      Este e-mail foi enviado pelo Norte · Você está recebendo porque tem uma conta conosco.<br>
      © ${new Date().getFullYear()} Norte · LGPD: seus dados estão protegidos.
    </div>
  </div>
</body>
</html>`;

// ─── Templates ───

const templates = Object.freeze({

  // E01: Verificação de conta
  verifyEmail: ({ name, verifyUrl }) => ({
    subject: '✅ Confirme seu e-mail — Norte',
    html: baseLayout(`
      <p>Olá, <strong>${name}</strong>! 👋</p>
      <p>Seja bem-vindo(a) ao Norte. Só falta confirmar seu e-mail para começar a organizar suas finanças.</p>
      <div style="text-align:center">
        <a href="${verifyUrl}" class="btn">Confirmar meu e-mail</a>
      </div>
      <div class="alert">
        ⏰ Este link expira em <strong>24 horas</strong>. Se você não criou esta conta, ignore este e-mail.
      </div>
      <p style="color:#9CA3AF; font-size:13px">Ou cole no navegador: ${verifyUrl}</p>
    `),
  }),

  // E01: Recuperação de senha
  resetPassword: ({ name, resetUrl }) => ({
    subject: '🔑 Redefinição de senha — Norte',
    html: baseLayout(`
      <p>Olá, <strong>${name || 'usuário'}</strong>.</p>
      <p>Recebemos uma solicitação para redefinir a senha da sua conta Norte.</p>
      <div style="text-align:center">
        <a href="${resetUrl}" class="btn">Redefinir minha senha</a>
      </div>
      <div class="alert">
        ⏰ Este link expira em <strong>30 minutos</strong> e só pode ser usado uma vez.<br>
        Se não foi você, sua senha continua segura — ignore este e-mail.
      </div>
      <p style="color:#9CA3AF; font-size:13px">Link: ${resetUrl}</p>
    `),
  }),

  // E01: 2FA ativado
  twoFactorEnabled: ({ name }) => ({
    subject: '🔐 Autenticação em dois fatores ativada — Norte',
    html: baseLayout(`
      <p>Olá, <strong>${name}</strong>.</p>
      <p>A autenticação em dois fatores (2FA) foi ativada com sucesso na sua conta Norte. 🎉</p>
      <p>A partir de agora, você precisará do código do seu app autenticador (Google Authenticator ou Authy) toda vez que fizer login.</p>
      <div class="alert">
        ⚠️ Se não foi você que ativou o 2FA, acesse sua conta imediatamente e encerre todas as sessões.
      </div>
    `),
  }),

  // E02: Alerta de orçamento (80%)
  budgetAlert80: ({ name, categoryName, spent, limit, month }) => ({
    subject: `⚠️ ${categoryName}: 80% do orçamento usado — Norte`,
    html: baseLayout(`
      <p>Olá, <strong>${name}</strong>.</p>
      <p>Seu orçamento de <strong>${categoryName}</strong> em ${month} está quase no limite.</p>
      <table class="table">
        <tr><td>💰 Limite do mês</td><td>${limit}</td></tr>
        <tr><td>💸 Gasto até agora</td><td>${spent}</td></tr>
        <tr><td>🟡 Uso</td><td>80%</td></tr>
      </table>
      <p>No ritmo atual, você pode ultrapassar o limite antes do fim do mês. Que tal revisar seus gastos?</p>
      <div style="text-align:center">
        <a href="${process.env.APP_URL || 'http://localhost:3000'}/#budgets" class="btn">Ver orçamentos</a>
      </div>
    `),
  }),

  // E02: Alerta de orçamento (100%)
  budgetAlert100: ({ name, categoryName, spent, limit, month }) => ({
    subject: `🚨 ${categoryName}: orçamento estourado — Norte`,
    html: baseLayout(`
      <p>Olá, <strong>${name}</strong>.</p>
      <p>Seu orçamento de <strong>${categoryName}</strong> em ${month} foi <strong style="color:#EF4444">ultrapassado</strong>.</p>
      <table class="table">
        <tr><td>💰 Limite</td><td>${limit}</td></tr>
        <tr><td>💸 Gasto</td><td style="color:#EF4444"><strong>${spent}</strong></td></tr>
      </table>
      <div class="alert" style="background:#FEE2E2; border-color:#EF4444; color:#7F1D1D">
        🚨 Considere ajustar seu orçamento ou reduzir os gastos nesta categoria.
      </div>
      <div style="text-align:center">
        <a href="${process.env.APP_URL || 'http://localhost:3000'}/#budgets" class="btn" style="background:#EF4444">Ver orçamentos</a>
      </div>
    `),
  }),

  // E06: Meta concluída
  goalCompleted: ({ name, goalName, targetAmount }) => ({
    subject: `🎉 Meta "${goalName}" concluída! — Norte`,
    html: baseLayout(`
      <p>Parabéns, <strong>${name}</strong>! 🎉🎊</p>
      <p>Você concluiu a meta <strong>"${goalName}"</strong> de <strong>${targetAmount}</strong>!</p>
      <p>Isso é fruto de disciplina e planejamento. Agora é hora de celebrar — e definir o próximo sonho. 🚀</p>
      <div style="text-align:center">
        <a href="${process.env.APP_URL || 'http://localhost:3000'}/#goals" class="btn">Ver minhas metas</a>
      </div>
    `),
  }),

  // E09: Convite de compartilhamento (casal/família)
  sharingInvite: ({ fromName, inviteUrl, sharedCategories }) => ({
    subject: `📬 ${fromName} quer compartilhar finanças com você — Norte`,
    html: baseLayout(`
      <p><strong>${fromName}</strong> enviou um convite para compartilhar parte das finanças com você no Norte.</p>
      ${sharedCategories?.length ? `<p>Categorias compartilhadas: <strong>${sharedCategories.join(', ')}</strong></p>` : ''}
      <div style="text-align:center">
        <a href="${inviteUrl}" class="btn">Aceitar convite</a>
      </div>
      <div class="alert">
        Você pode revogar o acesso a qualquer momento nas configurações.
      </div>
    `),
  }),

  // LGPD: Solicitação de exclusão
  deletionRequested: ({ name, deletionDate }) => ({
    subject: '⚠️ Solicitação de exclusão de conta recebida — Norte',
    html: baseLayout(`
      <p>Olá, <strong>${name}</strong>.</p>
      <p>Recebemos sua solicitação de exclusão de conta. Conforme a LGPD, sua conta e todos os dados associados serão <strong>excluídos permanentemente</strong> em:</p>
      <div style="text-align:center; font-size:24px; font-weight:800; color:#EF4444; margin: 24px 0">
        📅 ${deletionDate}
      </div>
      <p>Se mudar de ideia antes dessa data, acesse sua conta e cancele a solicitação.</p>
      <div class="alert">
        Após a exclusão, não será possível recuperar seus dados. Sugerimos exportar um backup antes.
      </div>
      <div style="text-align:center">
        <a href="${process.env.APP_URL || 'http://localhost:3000'}/#settings/export" class="btn" style="background:#6B7280">Exportar meus dados</a>
      </div>
    `),
  }),

  // Relatório semanal (resumo financeiro)
  weeklyDigest: ({ name, totalIncome, totalExpenses, topCategory, healthScore, month }) => ({
    subject: `📊 Seu resumo financeiro de ${month} — Norte`,
    html: baseLayout(`
      <p>Olá, <strong>${name}</strong>! Aqui está seu resumo da semana:</p>
      <table class="table">
        <tr><td>💚 Receitas</td><td style="color:#10B981">${totalIncome}</td></tr>
        <tr><td>💸 Despesas</td><td style="color:#EF4444">${totalExpenses}</td></tr>
        <tr><td>🏆 Maior gasto</td><td>${topCategory}</td></tr>
        <tr><td>❤️ Health Score</td><td><strong>${healthScore}/100</strong></td></tr>
      </table>
      <div style="text-align:center">
        <a href="${process.env.APP_URL || 'http://localhost:3000'}/#reports" class="btn">Ver relatório completo</a>
      </div>
    `),
  }),
});

// ─── Funções de envio (usadas pelos serviços de domínio) ───

const sendVerificationEmail = (email, { name, userId }) => {
  const verifyUrl = `${process.env.APP_URL || 'http://localhost:3000'}/api/v1/auth/verify?token=${userId}`;
  const tmpl = templates.verifyEmail({ name, verifyUrl });
  return send({ to: email, ...tmpl });
};

const sendResetEmail = (email, { name, token }) => {
  const resetUrl = `${process.env.APP_URL || 'http://localhost:3000'}/auth.html?reset=${token}`;
  const tmpl = templates.resetPassword({ name, resetUrl });
  return send({ to: email, ...tmpl });
};

const send2FAEnabledEmail = (email, { name }) => {
  const tmpl = templates.twoFactorEnabled({ name });
  return send({ to: email, ...tmpl });
};

const sendBudgetAlert = (email, { name, categoryName, spent, limit, month, level }) => {
  const key = level === 100 ? 'budgetAlert100' : 'budgetAlert80';
  const tmpl = templates[key]({ name, categoryName, spent, limit, month });
  return send({ to: email, ...tmpl });
};

const sendGoalCompletedEmail = (email, { name, goalName, targetAmount }) => {
  const tmpl = templates.goalCompleted({ name, goalName, targetAmount });
  return send({ to: email, ...tmpl });
};

const sendSharingInvite = (email, { fromName, inviteUrl, sharedCategories }) => {
  const tmpl = templates.sharingInvite({ fromName, inviteUrl, sharedCategories });
  return send({ to: email, ...tmpl });
};

const sendDeletionRequested = (email, { name, deletionDate }) => {
  const tmpl = templates.deletionRequested({ name, deletionDate });
  return send({ to: email, ...tmpl });
};

const sendWeeklyDigest = (email, payload) => {
  const tmpl = templates.weeklyDigest(payload);
  return send({ to: email, ...tmpl });
};

module.exports = Object.freeze({
  send,
  templates,
  sendVerificationEmail,
  sendResetEmail,
  send2FAEnabledEmail,
  sendBudgetAlert,
  sendGoalCompletedEmail,
  sendSharingInvite,
  sendDeletionRequested,
  sendWeeklyDigest,
});
