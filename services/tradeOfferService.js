import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Trade Offers Datei
const TRADES_FILE = path.join(__dirname, '../data/trade-offers.json');

// Lade Trade Offers
function loadTradeOffers() {
  if (fs.existsSync(TRADES_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(TRADES_FILE, 'utf-8'));
    } catch (error) {
      console.error('Error loading trade offers:', error);
      return {};
    }
  }
  return {}; // { offerId: TradeOffer }
}

// Speichere Trade Offers
function saveTradeOffers(offers) {
  const dataDir = path.dirname(TRADES_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(TRADES_FILE, JSON.stringify(offers, null, 2));
}

/**
 * Erstelle ein neues Trade Offer
 */
export function createTradeOffer(maker, offerCards, requestCards, expiresAt, signature) {
  const offers = loadTradeOffers();
  
  const offerId = crypto.randomUUID();
  const offer = {
    offerId,
    maker,
    offerCards,
    requestCards,
    expiresAt,
    signature,
    createdAt: new Date().toISOString(),
    status: 'active',
  };
  
  offers[offerId] = offer;
  saveTradeOffers(offers);
  
  console.log(`[TradeOffer] Created offer ${offerId} by ${maker}`);
  return offer;
}

/**
 * Hole alle aktiven Trade Offers
 */
export function getActiveTradeOffers() {
  const offers = loadTradeOffers();
  const now = Math.floor(Date.now() / 1000);
  
  return Object.values(offers).filter((offer) => {
    if (offer.status !== 'active') return false;
    if (offer.expiresAt < now) {
      // Markiere als expired
      offer.status = 'expired';
      saveTradeOffers(offers);
      return false;
    }
    return true;
  });
}

/**
 * Hole alle Trade Offers
 */
export function getAllTradeOffers() {
  const offers = loadTradeOffers();
  const now = Math.floor(Date.now() / 1000);
  
  // Markiere abgelaufene Offers
  Object.values(offers).forEach((offer) => {
    if (offer.status === 'active' && offer.expiresAt < now) {
      offer.status = 'expired';
    }
  });
  
  saveTradeOffers(offers);
  return Object.values(offers);
}

/**
 * Hole ein einzelnes Trade Offer
 */
export function getTradeOffer(offerId) {
  const offers = loadTradeOffers();
  const offer = offers[offerId];
  
  if (offer && offer.status === 'active') {
    const now = Math.floor(Date.now() / 1000);
    if (offer.expiresAt < now) {
      offer.status = 'expired';
      saveTradeOffers(offers);
    }
  }
  
  return offer || null;
}

/**
 * Aktualisiere Trade Offer Status
 */
export function updateTradeOfferStatus(offerId, status) {
  const offers = loadTradeOffers();
  if (offers[offerId]) {
    offers[offerId].status = status;
    saveTradeOffers(offers);
    console.log(`[TradeOffer] Updated offer ${offerId} to status ${status}`);
    return offers[offerId];
  }
  return null;
}

/**
 * Lösche ein Trade Offer
 */
export function deleteTradeOffer(offerId) {
  const offers = loadTradeOffers();
  if (offers[offerId]) {
    delete offers[offerId];
    saveTradeOffers(offers);
    console.log(`[TradeOffer] Deleted offer ${offerId}`);
    return true;
  }
  return false;
}

/**
 * Speichere Maker-PSBTs im Offer (für später, wenn Maker signiert)
 */
export function saveMakerPsbts(offerId, makerPsbts) {
  const offers = loadTradeOffers();
  if (offers[offerId]) {
    offers[offerId].makerPsbts = makerPsbts;
    offers[offerId].makerPsbtsSavedAt = new Date().toISOString();
    saveTradeOffers(offers);
    console.log(`[TradeOffer] Saved ${makerPsbts.length} maker PSBTs for offer ${offerId}`);
    return offers[offerId];
  }
  return null;
}

/**
 * Hole Maker-PSBTs für ein Offer
 */
export function getMakerPsbts(offerId) {
  const offers = loadTradeOffers();
  const offer = offers[offerId];
  if (offer && offer.makerPsbts) {
    return offer.makerPsbts;
  }
  return null;
}

/**
 * Speichere signierte Maker-PSBTs im Offer
 */
export function saveMakerSignedPsbts(offerId, signedPsbts) {
  const offers = loadTradeOffers();
  if (offers[offerId]) {
    offers[offerId].makerSignedPsbts = signedPsbts;
    offers[offerId].makerSignedAt = new Date().toISOString();
    saveTradeOffers(offers);
    console.log(`[TradeOffer] Saved ${signedPsbts.length} signed maker PSBTs for offer ${offerId}`);
    return offers[offerId];
  }
  return null;
}

/**
 * Hole signierte Maker-PSBTs für ein Offer
 */
export function getMakerSignedPsbts(offerId) {
  const offers = loadTradeOffers();
  const offer = offers[offerId];
  if (offer && offer.makerSignedPsbts) {
    return offer.makerSignedPsbts;
  }
  return null;
}



