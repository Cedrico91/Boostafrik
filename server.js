/**
 * BoostAfrik — Backend Node.js
 * Intégration API ExoSupplier
 * ================================================
 * Installation : npm install express cors node-fetch
 * Lancement    : node server.js
 * ================================================
 */

const express  = require('express');
const cors     = require('cors');
const fetch    = require('node-fetch');

const app  = express();
const PORT = 3000;

// ── CONFIGURATION ─────────────────────────────────────────
const API_KEY = "8068578c078a21b2289c052b1638afa8";
const API_URL = "https://exosupplier.com/api/v2";

// Taux de conversion + marge (modifie la marge selon tes besoins)
const USD_TO_FCFA = 600;   // 1 USD = 600 FCFA
const MARGE       = 1.6;   // 60% de marge sur le prix fournisseur

// ── MIDDLEWARE ────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Sert les fichiers HTML du frontend

// ── HELPER : appel API ExoSupplier ────────────────────────
async function exoAPI(params) {
  const body = new URLSearchParams({ key: API_KEY, ...params });
  const res  = await fetch(API_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString()
  });
  return res.json();
}

// ═══════════════════════════════════════════════════════════
//  ROUTES API
// ═══════════════════════════════════════════════════════════

/**
 * GET /api/balance
 * Retourne le solde du compte ExoSupplier
 */
app.get('/api/balance', async (req, res) => {
  try {
    const data = await exoAPI({ action: 'balance' });
    res.json({ success: true, balance: data.balance, currency: data.currency });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/services
 * Retourne tous les services disponibles chez ExoSupplier
 * avec prix converti en FCFA et marge appliquée
 */
app.get('/api/services', async (req, res) => {
  try {
    const services = await exoAPI({ action: 'services' });

    // Ajouter le prix FCFA avec marge pour chaque service
    const servicesAvecPrix = services.map(svc => ({
      ...svc,
      prix_fcfa_pour_1000: Math.round(
        parseFloat(svc.rate) * USD_TO_FCFA * MARGE
      )
    }));

    res.json({ success: true, services: servicesAvecPrix });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/order
 * Passe une nouvelle commande
 * Body: { service_id, link, quantity, client_phone }
 */
app.post('/api/order', async (req, res) => {
  const { service_id, link, quantity, client_phone } = req.body;

  // Validation
  if (!service_id) return res.status(400).json({ success: false, error: 'service_id requis' });
  if (!link)       return res.status(400).json({ success: false, error: 'link requis' });
  if (!quantity)   return res.status(400).json({ success: false, error: 'quantity requis' });

  try {
    const data = await exoAPI({
      action:   'add',
      service:  service_id,
      link:     link,
      quantity: quantity
    });

    if (data.error) {
      return res.status(400).json({ success: false, error: data.error });
    }

    // Générer un ID de commande BoostAfrik
    const boostafrikId = 'BA-' + data.order;

    // TODO: Sauvegarder en base de données (MongoDB, MySQL, etc.)
    // db.orders.insert({ boostafrikId, exoOrderId: data.order, service_id, link, quantity, client_phone, status: 'pending', createdAt: new Date() })

    res.json({
      success:       true,
      order_id:      boostafrikId,
      exo_order_id:  data.order,
      message:       'Commande enregistrée avec succès'
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/order/:orderId
 * Vérifie le statut d'une commande
 * orderId : l'ID ExoSupplier (sans le préfixe BA-)
 */
app.get('/api/order/:orderId', async (req, res) => {
  const orderId = req.params.orderId.replace('BA-', '');

  try {
    const data = await exoAPI({ action: 'status', order: orderId });

    if (data.error) {
      return res.status(404).json({ success: false, error: data.error });
    }

    // Calculer le pourcentage de progression
    const startCount = parseInt(data.start_count) || 0;
    const remains    = parseInt(data.remains) || 0;
    const charge     = parseInt(data.charge) || 0;
    const total      = startCount + charge;
    const progress   = total > 0
      ? Math.min(100, Math.round(((total - remains) / total) * 100))
      : (data.status === 'Completed' ? 100 : 0);

    res.json({
      success:     true,
      status:      data.status,       // Pending, In progress, Completed, Partial, Cancelled
      start_count: startCount,
      remains:     remains,
      progress:    progress,
      currency:    data.currency
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/orders/bulk-status
 * Vérifie le statut de plusieurs commandes en une fois
 * Body: { order_ids: [123, 456, 789] }
 */
app.post('/api/orders/bulk-status', async (req, res) => {
  const { order_ids } = req.body;
  if (!order_ids || !order_ids.length) {
    return res.status(400).json({ success: false, error: 'order_ids requis' });
  }

  try {
    const data = await exoAPI({
      action: 'status',
      orders: order_ids.join(',')
    });
    res.json({ success: true, orders: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/order/:orderId/refill
 * Demande un refill pour une commande
 */
app.post('/api/order/:orderId/refill', async (req, res) => {
  const orderId = req.params.orderId.replace('BA-', '');
  try {
    const data = await exoAPI({ action: 'refill', order: orderId });
    res.json({ success: true, refill: data.refill });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/order/:orderId/cancel
 * Annule une commande (seulement si elle est encore en attente)
 */
app.post('/api/order/:orderId/cancel', async (req, res) => {
  const orderId = req.params.orderId.replace('BA-', '');
  try {
    const data = await exoAPI({ action: 'cancel', orders: orderId });
    res.json({ success: true, result: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DÉMARRAGE ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ BoostAfrik Backend démarré sur http://localhost:${PORT}`);
  console.log(`🔑 API ExoSupplier connectée`);
  console.log(`💰 Marge appliquée : ${((MARGE - 1) * 100).toFixed(0)}%`);
  console.log(`💱 Taux FCFA : 1 USD = ${USD_TO_FCFA} FCFA\n`);
});
