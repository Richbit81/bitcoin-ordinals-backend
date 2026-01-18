/**
 * 🎯 PROJECT CONFIG SYSTEM - Central Hub
 * Verwaltet alle Projekt-Konfigurationen und bietet Validierungs-Helpers
 */

import { BLACK_AND_WILD_CONFIG } from './black-and-wild.js';
import { TECH_AND_GAMES_CONFIG } from './tech-and-games.js';

// Zentrale Registry aller Projekte
export const PROJECT_CONFIGS = {
  'black-and-wild': BLACK_AND_WILD_CONFIG,
  'tech-and-games': TECH_AND_GAMES_CONFIG
};

// Helper: Liste aller verfügbaren Projekt-IDs
export function getAllProjectIds() {
  return Object.keys(PROJECT_CONFIGS);
}

// Helper: Hole Projekt-Config
export function getProjectConfig(projectId) {
  return PROJECT_CONFIGS[projectId] || null;
}

// Helper: Hole alle Original-IDs für ein Projekt
export function getProjectOriginals(projectId) {
  const config = PROJECT_CONFIGS[projectId];
  return config ? config.originals : [];
}

// Helper: Hole alle Original-Inscription-IDs als Array (für schnellen Lookup)
export function getProjectOriginalInscriptionIds(projectId) {
  const originals = getProjectOriginals(projectId);
  return originals.map(o => o.inscriptionId);
}

/**
 * 💣 KRITISCH: Validiere ob eine originalInscriptionId zu einem Projekt gehört
 * @param {string} originalInscriptionId - Die zu prüfende Original-ID
 * @param {string} projectId - Die Projekt-ID
 * @returns {boolean} - True wenn die ID zum Projekt gehört
 */
export function validateOriginalForProject(originalInscriptionId, projectId) {
  if (!originalInscriptionId || !projectId) {
    return false;
  }
  
  const config = PROJECT_CONFIGS[projectId];
  if (!config) {
    console.warn(`[ProjectConfig] ⚠️ Unknown project: ${projectId}`);
    return false;
  }
  
  const isValid = config.originals.some(o => o.inscriptionId === originalInscriptionId);
  
  if (!isValid) {
    console.warn(`[ProjectConfig] ⚠️ originalInscriptionId ${originalInscriptionId} does NOT belong to project ${projectId}`);
  }
  
  return isValid;
}

/**
 * 🔍 HELPER: Finde Projekt für eine gegebene originalInscriptionId
 * @param {string} originalInscriptionId - Die zu suchende Original-ID
 * @returns {object|null} - { projectId, projectName, cardData } oder null
 */
export function findProjectByOriginalId(originalInscriptionId) {
  if (!originalInscriptionId) return null;
  
  for (const [projectId, config] of Object.entries(PROJECT_CONFIGS)) {
    const card = config.originals.find(o => o.inscriptionId === originalInscriptionId);
    if (card) {
      return {
        projectId,
        projectName: config.projectName,
        cardData: card
      };
    }
  }
  
  return null;
}

/**
 * 💣 KRITISCH: Validiere Kartenname + originalInscriptionId Kombination
 * @param {string} cardName - Name der Karte (z.B. "Wolf", "BLOCKTRIS")
 * @param {string} originalInscriptionId - Die Original-ID
 * @param {string} projectId - Die Projekt-ID
 * @returns {object} - { valid: boolean, error?: string, suggestion?: string }
 */
export function validateCardNameAndOriginalId(cardName, originalInscriptionId, projectId) {
  if (!cardName || !originalInscriptionId || !projectId) {
    return {
      valid: false,
      error: 'Missing required parameters'
    };
  }
  
  const config = PROJECT_CONFIGS[projectId];
  if (!config) {
    return {
      valid: false,
      error: `Unknown project: ${projectId}`
    };
  }
  
  // Finde Karte mit dieser originalInscriptionId
  const cardByOriginal = config.originals.find(o => o.inscriptionId === originalInscriptionId);
  
  if (!cardByOriginal) {
    // Prüfe ob die ID zu einem anderen Projekt gehört
    const otherProject = findProjectByOriginalId(originalInscriptionId);
    
    if (otherProject) {
      return {
        valid: false,
        error: `originalInscriptionId ${originalInscriptionId} belongs to project "${otherProject.projectName}" (${otherProject.projectId}), not "${config.projectName}" (${projectId})`,
        suggestion: `This is card "${otherProject.cardData.name}" from ${otherProject.projectName}`
      };
    }
    
    return {
      valid: false,
      error: `originalInscriptionId ${originalInscriptionId} not found in any project`
    };
  }
  
  // Prüfe ob Name übereinstimmt (case-insensitive)
  const nameMatch = cardByOriginal.name.toLowerCase() === cardName.toLowerCase();
  
  if (!nameMatch) {
    return {
      valid: false,
      error: `Card name mismatch: Got "${cardName}" but originalInscriptionId ${originalInscriptionId} belongs to "${cardByOriginal.name}"`,
      suggestion: `Use name "${cardByOriginal.name}" instead of "${cardName}"`
    };
  }
  
  return {
    valid: true,
    cardData: cardByOriginal
  };
}

/**
 * 📊 STATISTIK: Hole Projekt-Stats
 */
export function getProjectStats() {
  const stats = {};
  
  for (const [projectId, config] of Object.entries(PROJECT_CONFIGS)) {
    const originals = config.originals;
    const byCategory = {};
    const byRarity = {};
    
    originals.forEach(card => {
      // Count by category
      byCategory[card.category] = (byCategory[card.category] || 0) + 1;
      // Count by rarity
      byRarity[card.rarity] = (byRarity[card.rarity] || 0) + 1;
    });
    
    stats[projectId] = {
      projectName: config.projectName,
      totalOriginals: originals.length,
      byCategory,
      byRarity,
      hasMissingIds: originals.some(o => o.inscriptionId.includes('PLACEHOLDER'))
    };
  }
  
  return stats;
}

// Export für einfachen Import
export default {
  PROJECT_CONFIGS,
  getAllProjectIds,
  getProjectConfig,
  getProjectOriginals,
  getProjectOriginalInscriptionIds,
  validateOriginalForProject,
  findProjectByOriginalId,
  validateCardNameAndOriginalId,
  getProjectStats
};
