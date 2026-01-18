/**
 * 💣 VALIDATION SERVICE - Bombensichere Validierung
 * Stellt sicher, dass keine falschen Daten in die DB gelangen
 */

import projectConfig from '../config/projects/index.js';

/**
 * Validiere Delegate-Karten-Daten vor dem Speichern
 * @param {Object} cardData - Kartendaten
 * @param {string} cardData.cardName - Name der Karte
 * @param {string} cardData.originalInscriptionId - Original-Inscription-ID
 * @param {string} [cardData.projectId] - Projekt-ID (optional, wird auto-detected wenn nicht vorhanden)
 * @returns {Object} - { valid: boolean, error?: string, projectId?: string }
 */
export function validateDelegateCard(cardData) {
  const { cardName, originalInscriptionId } = cardData;
  
  // Basic validation
  if (!cardName) {
    return {
      valid: false,
      error: 'Card name is required'
    };
  }
  
  if (!originalInscriptionId) {
    return {
      valid: false,
      error: 'originalInscriptionId is required'
    };
  }
  
  // Prüfe ob es ein Placeholder ist
  if (originalInscriptionId.includes('PLACEHOLDER')) {
    return {
      valid: false,
      error: `originalInscriptionId contains PLACEHOLDER - this is not a real inscription ID: ${originalInscriptionId}`
    };
  }
  
  // Wenn projectId angegeben ist, validiere gegen dieses Projekt
  if (cardData.projectId) {
    const validation = projectConfig.validateCardNameAndOriginalId(
      cardName,
      originalInscriptionId,
      cardData.projectId
    );
    
    if (!validation.valid) {
      return {
        valid: false,
        error: validation.error,
        suggestion: validation.suggestion
      };
    }
    
    return {
      valid: true,
      projectId: cardData.projectId,
      cardData: validation.cardData
    };
  }
  
  // Kein projectId angegeben - versuche Auto-Detection
  const projectInfo = projectConfig.findProjectByOriginalId(originalInscriptionId);
  
  if (!projectInfo) {
    return {
      valid: false,
      error: `originalInscriptionId ${originalInscriptionId} not found in any project. This might be a corrupted or invalid ID.`,
      warning: 'If this is a new card, please add it to the appropriate project config first.'
    };
  }
  
  // Prüfe ob Name übereinstimmt
  const nameMatch = projectInfo.cardData.name.toLowerCase() === cardName.toLowerCase();
  
  if (!nameMatch) {
    return {
      valid: false,
      error: `Card name mismatch: "${cardName}" does not match "${projectInfo.cardData.name}" for originalInscriptionId ${originalInscriptionId}`,
      suggestion: `Use card name "${projectInfo.cardData.name}" instead`,
      detectedProject: projectInfo.projectId
    };
  }
  
  return {
    valid: true,
    projectId: projectInfo.projectId,
    projectName: projectInfo.projectName,
    cardData: projectInfo.cardData
  };
}

/**
 * Validiere Collection-Daten
 * @param {Object} collectionData - Collection-Daten
 * @param {string} collectionData.name - Name der Collection
 * @param {string} [collectionData.projectId] - Projekt-ID
 * @param {Array} collectionData.items - Items in der Collection
 * @returns {Object} - { valid: boolean, error?: string, warnings?: string[] }
 */
export function validateCollection(collectionData) {
  const { name, items, projectId } = collectionData;
  
  if (!name) {
    return {
      valid: false,
      error: 'Collection name is required'
    };
  }
  
  if (!items || !Array.isArray(items) || items.length === 0) {
    return {
      valid: false,
      error: 'Collection must have at least one item'
    };
  }
  
  const warnings = [];
  
  // Wenn projectId angegeben, prüfe alle Items
  if (projectId) {
    const projectOriginals = projectConfig.getProjectOriginalInscriptionIds(projectId);
    
    items.forEach((item, index) => {
      if (item.type === 'original' && item.inscriptionId) {
        if (!projectOriginals.includes(item.inscriptionId)) {
          warnings.push(`Item ${index + 1} (${item.inscriptionId}) does not belong to project ${projectId}`);
        }
      }
    });
  }
  
  return {
    valid: true,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

/**
 * Helper: Logge Validierungs-Fehler mit Details
 */
export function logValidationError(context, validation) {
  console.error(`[Validation] ❌ ${context} - Validation failed:`);
  console.error(`[Validation]    Error: ${validation.error}`);
  if (validation.suggestion) {
    console.error(`[Validation]    💡 Suggestion: ${validation.suggestion}`);
  }
  if (validation.detectedProject) {
    console.error(`[Validation]    🔍 Detected Project: ${validation.detectedProject}`);
  }
}

export default {
  validateDelegateCard,
  validateCollection,
  logValidationError
};
