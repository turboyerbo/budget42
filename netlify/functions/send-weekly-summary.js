// Netlify Function: Send weekly budget summary email via Brevo
// Requires env vars: BREVO_EMAIL, BREVO_API_KEY
// Call via: curl -X POST https://budgetfortwo.netlify.app/.netlify/functions/send-weekly-summary -H "Content-Type: application/json" -d '{...}'

const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { email, spending, bills, income, startDate, endDate } = JSON.parse(event.body);

    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing email' }) };
    }

    const emailHTML = generateEmailHTML({
      email,
      spending: spending || {},
      bills: bills || { upcoming: [], paid: 0 },
      income: income || 0,
      startDate,
      endDate,
    });

    // Check for required env vars
    if (!process.env.BREVO_EMAIL || !process.env.BREVO_API_KEY) {
      return { 
        statusCode: 500, 
        body: JSON.stringify({ error: 'Email service not configured. Set BREVO_EMAIL and BREVO_API_KEY env vars.' }) 
      };
    }

    // Configure Brevo SMTP transport
    const transporter = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false, // TLS
      auth: {
        user: process.env.BREVO_EMAIL,
        pass: process.env.BREVO_API_KEY,
      },
    });

    // Send email
    const info = await transporter.sendMail({
      from: `"Budget For Two" <${process.env.BREVO_EMAIL}>`,
      to: email,
      subject: `📊 Weekly Budget Summary - ${startDate} to ${endDate}`,
      html: emailHTML,
    });

    console.log('Email sent successfully:', info.messageId);

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        message: 'Email sent',
        messageId: info.messageId,
      }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

function generateEmailHTML({ email, spending, bills, income, startDate, endDate }) {
  const totalSpent = spending.total || 0;
  const avgDaily = (totalSpent / 7).toFixed(2);
  
  const upcomingBillsHTML = (bills.upcoming || [])
    .map(b => `<tr>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">
        <strong style="color: #1a1a18;">${b.label}</strong><br>
        <span style="color: #888; font-size: 12px;">Due ${b.date}</span>
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">
        <strong style="color: #1a1a18;">$${b.amount.toFixed(2)}</strong>
      </td>
    </tr>`)
    .join('');

  const paidBillsHTML = bills.paid > 0
    ? `<p style="margin: 10px 0; font-size: 14px; color: #1a7a4a;">✅ ${bills.paid} bill${bills.paid !== 1 ? 's' : ''} paid this week</p>`
    : '';

  const incomeHTML = income > 0
    ? `<p style="margin: 10px 0; font-size: 14px; color: #0369a1;">💰 Expected income: $${income.toFixed(2)}</p>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a18; line-height: 1.6; background: #f9f9f9; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; background: white; border-radius: 12px; }
    .header { background: linear-gradient(135deg, #1a7a4a 0%, #15654a 100%); color: white; padding: 30px 20px; border-radius: 10px; margin-bottom: 20px; text-align: center; }
    .header h1 { margin: 0; font-size: 28px; font-weight: 600; }
    .header p { margin: 5px 0 0; opacity: 0.9; font-size: 14px; }
    .card { background: #f5f3ef; padding: 20px; border-radius: 10px; margin-bottom: 20px; }
    .stat { display: inline-block; width: 48%; margin-right: 2%; text-align: center; }
    .stat-value { font-size: 32px; font-weight: 600; color: #1a7a4a; }
    .stat-label { font-size: 11px; color: #888; text-transform: uppercase; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; }
    .footer { font-size: 12px; color: #888; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
    .cta { background: #1a7a4a; color: white; padding: 12px 20px; border-radius: 8px; text-decoration: none; display: inline-block; margin: 15px 0; font-weight: 600; }
  </style>
</head>
<body style="margin: 0; padding: 20px; background: #f9f9f9;">
  <div class="container">
    <div class="header">
      <h1>📊 Weekly Budget Summary</h1>
      <p>${startDate} — ${endDate}</p>
    </div>

    <div class="card">
      <h2 style="margin-top: 0; color: #1a1a18; font-size: 20px;">This Week's Overview</h2>
      <div>
        <div class="stat">
          <div class="stat-value">$${totalSpent.toFixed(2)}</div>
          <div class="stat-label">Total Spent</div>
        </div>
        <div class="stat">
          <div class="stat-value">$${avgDaily}</div>
          <div class="stat-label">Daily Average</div>
        </div>
      </div>
      ${paidBillsHTML}
      ${incomeHTML}
    </div>

    ${bills.upcoming && bills.upcoming.length > 0 ? `
    <div class="card">
      <h2 style="margin-top: 0; color: #1a1a18; font-size: 20px;">📅 Upcoming Bills & Deadlines</h2>
      <table>
        ${upcomingBillsHTML}
      </table>
      <p style="margin-top: 15px; font-size: 12px; color: #888; background: #fff; padding: 10px; border-radius: 6px;">
        💡 Go to your Bills tab to mark items as paid and track payment status.
      </p>
    </div>
    ` : ''}

    <div style="background: #e8f4f8; padding: 15px; border-radius: 10px; margin-bottom: 20px;">
      <p style="margin: 0; font-size: 14px; color: #0369a1;">
        <strong>💚 Great work!</strong> You're tracking your spending and managing bills responsibly. Keep it up!
      </p>
    </div>

    <div style="text-align: center;">
      <a href="https://budgetfortwo.netlify.app" class="cta">View Your Budget</a>
    </div>

    <div class="footer">
      <p style="margin: 0;">Budget For Two • budgetfortwo.netlify.app</p>
      <p style="margin: 8px 0 0; font-size: 11px;">Privacy first • No data collection • Educational tool</p>
    </div>
  </div>
</body>
</html>`;
}
