/**
 * 🎮 TECH & GAMES - Project Configuration
 * Definiert alle Original-Inscriptions für das Tech & Games Projekt
 * 
 * ⚠️ HINWEIS: Diese IDs sind PLATZHALTER und müssen durch die ECHTEN Inscription IDs ersetzt werden!
 * Die falschen Einträge in der DB (mit Black & Wild IDs) müssen gelöscht werden.
 */

export const TECH_AND_GAMES_CONFIG = {
  projectId: 'tech-and-games',
  projectName: 'Tech & Games',
  description: 'Technology and gaming themed cards',
  
  // ⚠️ WICHTIG: Diese IDs müssen recherchiert und ersetzt werden!
  originals: [
    {
      id: 'blocktris',
      name: 'BLOCKTRIS',
      inscriptionId: 'PLACEHOLDER_BLOCKTRIS_NEEDS_REAL_ID', // ❌ MUSS ERSETZT WERDEN
      cardType: 'game',
      rarity: 'rare',
      category: 'game'
    },
    {
      id: 'timebit',
      name: 'TimeBIT',
      inscriptionId: 'PLACEHOLDER_TIMEBIT_NEEDS_REAL_ID', // ❌ MUSS ERSETZT WERDEN
      cardType: 'game',
      rarity: 'rare',
      category: 'game'
    },
    {
      id: 'slot-machine',
      name: 'Slot Machine',
      inscriptionId: '1164c8fc35613512724f816b98d4b147846d18afe506b62c6a6b552a325cbea9i0',
      cardType: 'game',
      rarity: 'uncommon',
      category: 'game'
    },
    {
      id: 'cat-tech',
      name: 'Cat',
      inscriptionId: 'e07446928e95b81b406592bf95007fb44948c252947304a7b31d34f84e96188ei0',
      cardType: 'animal',
      rarity: 'common',
      category: 'tech'
    },
    {
      id: 'gecko-tech',
      name: 'Gecko',
      inscriptionId: '9ad47ae89b8155ea8e4b02f53d4ced920d6dd4aeeaa744b99c44d33265827c44i0',
      cardType: 'animal',
      rarity: 'common',
      category: 'tech'
    },
    {
      id: 'grasshopper-tech',
      name: 'Grasshopper',
      inscriptionId: '62de7de2fba34ce0b5718e94970c19f5965b131316b9615c3c2c61421cb51e76i0',
      cardType: 'animal',
      rarity: 'common',
      category: 'tech'
    },
    {
      id: 'koala-tech',
      name: 'Koala',
      inscriptionId: '4f6cce4ab7433ef48222e0a974c3a546f102cf38a455368757f5d5e00bfc1dddi0',
      cardType: 'animal',
      rarity: 'common',
      category: 'tech'
    }
  ]
};

// ⚠️ ACHTUNG: Vor dem Deployment müssen folgende Schritte durchgeführt werden:
// 1. Echte Inscription IDs für BLOCKTRIS und TimeBIT recherchieren
// 2. DB-Einträge mit falschen IDs löschen (siehe cleanup-script)
// 3. Alle Tech & Games Karten korrekt re-minten mit richtigen IDs
