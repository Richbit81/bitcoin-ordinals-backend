/**
 * Bitcoin RPC Service
 * Kommuniziert mit Bitcoin Core über JSON-RPC
 */

const BITCOIN_RPC_HOST = process.env.BITCOIN_RPC_HOST || '127.0.0.1';
const BITCOIN_RPC_PORT = process.env.BITCOIN_RPC_PORT || 8332;
const BITCOIN_RPC_USER = process.env.BITCOIN_RPC_USER || 'bitcoinuser';
const BITCOIN_RPC_PASS = process.env.BITCOIN_RPC_PASS || '1oDqGECAjkB3vb8QswiRIVy5uF4ZWgTY';

const RPC_URL = `http://${BITCOIN_RPC_HOST}:${BITCOIN_RPC_PORT}`;

/**
 * Führt einen Bitcoin RPC-Call durch
 */
async function rpcCall(method, params = []) {
  const auth = Buffer.from(`${BITCOIN_RPC_USER}:${BITCOIN_RPC_PASS}`).toString('base64');
  
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: method,
      params: params
    })
  });

  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  return data.result;
}

/**
 * Prüft ob Bitcoin Core erreichbar ist
 */
export async function checkBitcoinConnection() {
  try {
    const info = await rpcCall('getblockchaininfo');
    return {
      connected: true,
      chain: info.chain,
      blocks: info.blocks,
      verificationProgress: info.verificationprogress,
      synced: info.verificationprogress >= 0.9999
    };
  } catch (error) {
    return {
      connected: false,
      error: error.message
    };
  }
}

/**
 * Ruft Blockchain-Info ab
 */
export async function getBlockchainInfo() {
  return await rpcCall('getblockchaininfo');
}

/**
 * Ruft Informationen über eine Transaktion ab
 */
export async function getTransaction(txid, verbose = true) {
  return await rpcCall('gettransaction', [txid, verbose]);
}

/**
 * Prüft ob eine Transaktion bestätigt ist
 */
export async function isTransactionConfirmed(txid, minConfirmations = 1) {
  try {
    const tx = await getTransaction(txid);
    return {
      confirmed: tx.confirmations >= minConfirmations,
      confirmations: tx.confirmations || 0,
      blockHeight: tx.blockheight || null
    };
  } catch (error) {
    return {
      confirmed: false,
      confirmations: 0,
      error: error.message
    };
  }
}

/**
 * Ruft UTXOs einer Adresse ab
 */
export async function getAddressUtxos(address) {
  try {
    // Verwende listunspent mit Adresse
    const utxos = await rpcCall('listunspent', [0, 9999999, [address]]);
    return utxos;
  } catch (error) {
    throw new Error(`Failed to get UTXOs: ${error.message}`);
  }
}

/**
 * Prüft ob eine Adresse eine bestimmte Inskription besitzt
 * (Vereinfacht - prüft ob UTXO mit Inskription existiert)
 */
export async function verifyInscriptionOwnership(address, inscriptionId) {
  try {
    // Extrahiere TXID aus Inskription-ID (Format: txidi0)
    const txid = inscriptionId.split('i')[0];
    
    // Prüfe ob Transaktion existiert
    const tx = await getTransaction(txid);
    
    if (!tx) {
      return {
        owns: false,
        reason: 'Transaction not found'
      };
    }
    
    // Prüfe ob Transaktion bestätigt ist
    if (tx.confirmations < 1) {
      return {
        owns: false,
        reason: 'Transaction not confirmed'
      };
    }
    
    // Prüfe ob Adresse in Outputs vorkommt
    // (Vereinfacht - für vollständige Prüfung bräuchten wir Ord-Integration)
    const addressInOutputs = tx.details?.some(detail => 
      detail.address === address && detail.category === 'receive'
    );
    
    return {
      owns: addressInOutputs || false,
      transaction: tx,
      confirmations: tx.confirmations
    };
  } catch (error) {
    return {
      owns: false,
      error: error.message
    };
  }
}

/**
 * Ruft Wallet-Balance ab (falls Wallet geladen ist)
 */
export async function getWalletBalance() {
  try {
    const balance = await rpcCall('getbalance');
    return {
      balance: balance,
      confirmed: balance
    };
  } catch (error) {
    // Wallet könnte nicht geladen sein
    return {
      balance: 0,
      error: error.message
    };
  }
}

/**
 * Prüft ob Bitcoin Core vollständig synchronisiert ist
 */
export async function isSynced() {
  try {
    const info = await getBlockchainInfo();
    return info.verificationprogress >= 0.9999;
  } catch (error) {
    return false;
  }
}

/**
 * Prüft den txindex-Status
 */
export async function getTxIndexStatus() {
  try {
    // Prüfe ob txindex aktiviert ist
    const info = await rpcCall('getindexinfo');
    const txindex = info.txindex || null;
    const blockchainInfo = await getBlockchainInfo();
    
    const bestBlockHeight = txindex ? txindex.best_block_height : blockchainInfo.blocks;
    const totalBlocks = blockchainInfo.blocks;
    const progress = totalBlocks > 0 ? (bestBlockHeight / totalBlocks) * 100 : 0;
    const remainingBlocks = totalBlocks - bestBlockHeight;
    
    return {
      enabled: txindex !== null,
      synced: txindex ? txindex.synced : false,
      bestBlockHeight: bestBlockHeight,
      totalBlocks: totalBlocks,
      remainingBlocks: remainingBlocks,
      progressPercent: Math.round(progress * 100) / 100
    };
  } catch (error) {
    // Fallback: Prüfe über getblockchaininfo
    try {
      const blockchainInfo = await getBlockchainInfo();
      return {
        enabled: null,
        synced: false,
        bestBlockHeight: blockchainInfo.blocks,
        totalBlocks: blockchainInfo.blocks,
        remainingBlocks: 0,
        progressPercent: 100,
        error: error.message
      };
    } catch (e) {
      return {
        enabled: null,
        synced: false,
        bestBlockHeight: null,
        totalBlocks: null,
        remainingBlocks: null,
        progressPercent: 0,
        error: error.message
      };
    }
  }
}



