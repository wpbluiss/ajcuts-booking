// Stripe Checkout Session for booking deposits
// Uses STRIPE_SECRET_KEY env var (set in Vercel project settings)

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const https = require('https');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!STRIPE_SECRET_KEY) {
    // No Stripe key configured — skip deposit, confirm directly
    res.status(200).json({ skip: true, message: 'Deposits not configured yet' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { service, price, name, phone, date, time, depositPercent } = body;

    const depositPct = depositPercent || 30;
    const depositAmount = Math.round(price * (depositPct / 100) * 100); // in cents

    const params = new URLSearchParams({
      'payment_method_types[0]': 'card',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][product_data][name]': 'AJ Cuts Deposit - ' + service,
      'line_items[0][price_data][product_data][description]': depositPct + '% deposit for ' + service + ' on ' + date + ' at ' + time,
      'line_items[0][price_data][unit_amount]': String(depositAmount),
      'line_items[0][quantity]': '1',
      'mode': 'payment',
      'success_url': 'https://ajcuts-booking.vercel.app/?booked=true&name=' + encodeURIComponent(name),
      'cancel_url': 'https://ajcuts-booking.vercel.app/?cancelled=true',
      'metadata[customer_name]': name,
      'metadata[customer_phone]': phone,
      'metadata[service]': service,
      'metadata[date]': date,
      'metadata[time]': time,
    });

    const data = params.toString();
    const result = await new Promise((resolve, reject) => {
      const r = https.request('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(STRIPE_SECRET_KEY + ':').toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(data),
        },
      }, (response) => {
        let c = '';
        response.on('data', d => c += d);
        response.on('end', () => {
          try { resolve(JSON.parse(c)); } catch (e) { reject(e); }
        });
      });
      r.on('error', reject);
      r.write(data);
      r.end();
    });

    if (result.url) {
      res.status(200).json({ url: result.url, sessionId: result.id });
    } else {
      console.error('Stripe error:', JSON.stringify(result));
      res.status(200).json({ skip: true, message: 'Stripe session creation failed' });
    }
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(200).json({ skip: true, message: err.message });
  }
};
