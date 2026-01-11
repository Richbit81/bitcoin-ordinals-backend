// Exportiere alle Karten-Informationen für Backend-Verwendung
// Diese Datei wird vom Admin-Endpoint verwendet

export const ALL_CARDS = [
  // COMMON (7 Karten)
  { id: 'card-1', name: 'Grasshopper', rarity: 'common', inscriptionId: '62de7de2fba34ce0b5718e94970c19f5965b131316b9615c3c2c61421cb51e76i0', cardType: 'animal' },
  { id: 'card-2', name: 'Ant', rarity: 'common', inscriptionId: '446045d1613fb57610840eb1c6ba1491d5b0ea9624f7bda585e5f52e256f91e1i0', cardType: 'animal' },
  { id: 'card-3', name: 'Bee', rarity: 'common', inscriptionId: '3aef296ead63f20a39c06ca04fc696dd98c532d6b595088fc58176cb46d1beaai0', cardType: 'animal' },
  { id: 'card-4', name: 'Chicken', rarity: 'common', inscriptionId: 'c907865db233272d06a262c19da7379d4d36f1088dd825375b29a73686a3a184i0', cardType: 'animal' },
  { id: 'card-5', name: 'Worm', rarity: 'common', inscriptionId: '7d91a2bb93f5ddfba2b16a6f0f463412e0faf12c46ca59cb2d76ec3b0bd3cf49i0', cardType: 'animal' },
  { id: 'card-6', name: 'Spider', rarity: 'common', inscriptionId: '8564dd1ffef7bb5e2501819e562d4f98d123959899a3348a8def8dc4e3c7409di0', cardType: 'animal' },
  { id: 'card-7', name: 'Butterfly', rarity: 'common', inscriptionId: '433c855aa38cc7b142dacaff65cfe9d58f2a79c40c87ddff56c3a283972a6a52i0', cardType: 'animal' },

  // UNCOMMON (5 Karten)
  { id: 'card-8', name: 'Worm', rarity: 'uncommon', inscriptionId: 'f56c0801566cb9e46e1465f1d760f8976ba0bad328e39e84fa2e2209a4d6c540i0', cardType: 'animal' },
  { id: 'card-9', name: 'Bird', rarity: 'uncommon', inscriptionId: 'd021efd186eb10c45fbdf043bf974e211772fce336d8287f02f85b6a06b2d8d9i0', cardType: 'animal' },
  { id: 'card-10', name: 'Bird', rarity: 'uncommon', inscriptionId: '9ffd078c797dfdcbb6f72482f5499c124dd67c47044ccda1a1c42bf89926f2f0i0', cardType: 'animal' },
  { id: 'card-11', name: 'Cow', rarity: 'uncommon', inscriptionId: '7f2a4963ed0c4e341db74d82dcc8c8fc0cdf4c84d7c1558f13b33b9ca6ef7251i0', cardType: 'animal' },
  { id: 'card-12', name: 'Cow', rarity: 'uncommon', inscriptionId: '171f1741831bb019ee18e2a92dae9c711abf07e153641a4c1ceaa5892133032ci0', cardType: 'animal' },

  // RARE (6 Karten)
  { id: 'card-14', name: 'Tiger', rarity: 'rare', inscriptionId: '195209f7e21b768fd7ca18a905ddac9ec4986412f4f8aa716290fbb743db6feai0', cardType: 'animal' },
  { id: 'card-15', name: 'Rabbit', rarity: 'rare', inscriptionId: 'a0b9f4f33913f512ba4de73b1e4982cf5be76874062287fcd05efdd76a220a7fi0', cardType: 'animal' },
  { id: 'card-17', name: 'Duck', rarity: 'rare', inscriptionId: 'a831e75a67d49d6e98594991cde68da3bf5f328ff49cc94a4a6bc05887ff8523i0', cardType: 'animal' },
  { id: 'card-18', name: 'Crow', rarity: 'rare', inscriptionId: 'd67b09d7ac06aa9c217f95c69bf5c76f7f1634cad92fff5829546a22a279072ci0', cardType: 'animal' },
  { id: 'card-19', name: 'Cat', rarity: 'rare', inscriptionId: 'e07446928e95b81b406592bf95007fb44948c252947304a7b31d34f84e96188ei0', cardType: 'animal' },
  { id: 'card-20', name: 'Gecko', rarity: 'rare', inscriptionId: '9ad47ae89b8155ea8e4b02f53d4ced920d6dd4aeeaa744b99c44d33265827c44i0', cardType: 'animal' },

  // EPIC (5 Karten)
  { id: 'card-21', name: 'Zebra', rarity: 'epic', inscriptionId: '3099b73fd35e81a8bf53a02af99f436d88b73b54945aaa97dfde155a08e174bdi0', cardType: 'animal' },
  { id: 'card-22', name: 'Sheep', rarity: 'epic', inscriptionId: '4d2d4a2b258b18b95bfc55dc3c31cbcd4b204a4f001c9861793b993487af4560i0', cardType: 'animal' },
  { id: 'card-23', name: 'Turtle', rarity: 'epic', inscriptionId: '3135eb862f9c56bf1884c05dd80bb28107ba9af82bed83fd39a1ff28e303a8a7i0', cardType: 'animal' },
  { id: 'card-24', name: 'Penguin', rarity: 'epic', inscriptionId: '2cd0572f35441d5b443ad9c78ec62f84f9b6c77528903c86b8b23b9213f0e7c4i0', cardType: 'animal' },
  { id: 'card-25', name: 'Koala', rarity: 'epic', inscriptionId: '4f6cce4ab7433ef48222e0a974c3a546f102cf38a455368757f5d5e00bfc1dddi0', cardType: 'animal' },

  // LEGENDARY (2 Karten)
  { id: 'card-26', name: 'Fox', rarity: 'legendary', inscriptionId: 'e1a16dd9dea8b6ade622d24214c21ec29029127d40aa8ad44aa07c39f4620866i0', cardType: 'animal' },
  { id: 'card-27', name: 'Octopus', rarity: 'legendary', inscriptionId: 'd52730b2f4b8c0095ad82853e3e27d72adaa65796dbb666d929d7ca36f570ad2i0', cardType: 'animal' },

  // MYSTIC LEGENDARY (1 Karte)
  { id: 'card-28', name: 'Ape', rarity: 'mystic-legendary', inscriptionId: '3898219212c8a1c66564e60734ab01872315c3900ef782b466caf4ae58c2afdbi0', cardType: 'animal' },

  // ACTION CARDS (12 Karten)
  { id: 'action-1', name: 'SLAP', rarity: 'common', inscriptionId: 'ef41bd80183a3d557cfba127b55bee1330ceb6d05e8b4746921b23b55ce133c9i0', cardType: 'action', effect: 'Deal 2 damage to any target.' },
  { id: 'action-2', name: 'WRONG MOVE', rarity: 'common', inscriptionId: 'd7e6610d2dcaed7bf6fb0923e5a8dbe0776dbe07a966b19d9bbbab4eaf298d50i0', cardType: 'action', effect: 'Destroy an animal with ATK 2 or less.' },
  { id: 'action-3', name: 'PANIC', rarity: 'uncommon', inscriptionId: '7d6ffeb90550adb8994e52eb6ca56ec42d19b20401a22af9ed959684b9c83ec4i0', cardType: 'action', effect: 'Both players discard their hands, then draw 3 cards.' },
  { id: 'action-4', name: 'NOPE', rarity: 'uncommon', inscriptionId: 'd1abdfb5c6318bdc45948cd88b03ae8057cf20bf955a6ed7fe7e011a6f895df9i0', cardType: 'action', effect: 'Cancel an action card.' },
  { id: 'action-5', name: 'OVERDOSE', rarity: 'rare', inscriptionId: '37b9fb329a6cf26de3e701da20c0217de97bcd839f18bceac3f43fea563f6b71i0', cardType: 'action', effect: 'Target animal gets +3 ATK until end of turn. Destroy it at the end of the turn.' },
  { id: 'action-6', name: 'SWITCH', rarity: 'rare', inscriptionId: 'fe1490d29120f1277596650462f33341a06a165bc037bb13e93af050935e4d75i0', cardType: 'action', effect: 'Swap control of two animals in play.' },
  { id: 'action-7', name: 'COLLAPSE', rarity: 'rare', inscriptionId: '9c1637a13a9f9c18bc232daefebab50033d14550afc51ea80dce4a6ae8b9d03ai0', cardType: 'action', effect: 'Deal 1 damage to all animals.' },
  { id: 'action-8', name: 'INSTINCT', rarity: 'epic', inscriptionId: '39367bda5c67a2a628261c2b0a3432c23929e864c7c12c5264b77d53341ecce0i0', cardType: 'action', effect: 'Trigger one animal\'s ability again.' },
  { id: 'action-9', name: 'STARE', rarity: 'epic', inscriptionId: 'bb48c48089f36680ac736fbb675dc29b9965a2e41a1ecd60dc70b70f9729df51i0', cardType: 'action', effect: 'Look at your opponent\'s hand. Choose one card – they discard it.' },
  { id: 'action-10', name: 'PUSH', rarity: 'epic', inscriptionId: '8da26d78071401ea4e69f16751612ae879543b438064a05ea89b17d0e7a92d99i0', cardType: 'action', effect: 'Target animal attacks immediately.' },
  { id: 'action-11', name: 'ACCIDENT', rarity: 'legendary', inscriptionId: '5687d374883dddcc97913fd286e180351443f9fd8f98af0f9e0f6bf199f5cde5i0', cardType: 'action', effect: 'Destroy a random animal.' },
  { id: 'action-12', name: 'LAST WORDS', rarity: 'legendary', inscriptionId: 'e6ac9fab61f8e30fb58c5d9224681ad2c1a9f064eb523c4a264a562648a486f9i0', cardType: 'action', effect: 'When an animal dies this turn, draw 2 cards.' },

  // STATUS CARDS (8 Karten)
  { id: 'status-1', name: 'BLEEDING', rarity: 'common', inscriptionId: '70b7048c1567f00c77aa05aa95db48d6838c4592a7d5c6d37e127667f9275050i0', cardType: 'status', effect: 'Attached animal loses 1 HP at the start of each turn.' },
  { id: 'status-2', name: 'STUCK', rarity: 'common', inscriptionId: 'f11b5ddc8a0a25a7cec94bc15c3fa32311808fe2cb87c2cea763f0d50c8b8e83i0', cardType: 'status', effect: 'Attached animal cannot attack.' },
  { id: 'status-3', name: 'TINT', rarity: 'uncommon', inscriptionId: '1656be81e09e210983360e549155c9115ff9411019ca24692ea77f4991a2afa5i0', cardType: 'status', effect: '−1 ATK. When this animal dies, draw 1 card.' },
  { id: 'status-4', name: 'TARGET', rarity: 'uncommon', inscriptionId: '27442fdd682add2aa8d10846e506ed29891b76cb09e4923d640bf83f392241a0i0', cardType: 'status', effect: 'Damage dealt to this animal is doubled.' },
  { id: 'status-5', name: 'SWARM', rarity: 'rare', inscriptionId: 'cf331de8d1d45a3759c80d6ca20409ac80bf4602c855396a101d1eb08cb36fc5i0', cardType: 'status', effect: 'Whenever an animal dies, both players take 1 damage.' },
  { id: 'status-6', name: 'SHIELD', rarity: 'epic', inscriptionId: 'd226c067ad6f7e083a7612d8b357051b824bdd63ca7bee7080611634abd28a1ai0', cardType: 'status', effect: 'Prevent the next damage dealt to attached animal.' },
  { id: 'status-7', name: 'RAGE', rarity: 'epic', inscriptionId: '0c7d863936f3c02134c472de45c7f5a2a0bce437a9914f2bd3a177c5c7a7efd4i0', cardType: 'status', effect: '+2 ATK. This animal must attack if able.' },
  { id: 'status-8', name: 'PARANOIA', rarity: 'legendary', inscriptionId: 'c68924eb89713ae2b169f3cf65c94c7f01d67130eb59987f861a5ace93733c11i0', cardType: 'status', effect: 'The controller of this card cannot draw cards.' },
];
