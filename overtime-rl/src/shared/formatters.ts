export const PLAYLIST_LABELS: Record<number, string> = {
  1: 'Casual 3v3 Standard',
  2: 'Casual 2v2 Doubles',
  3: 'Casual 1v1 Duel',
  4: 'Casual 4v4 Chaos',
  10: 'Ranked 1v1 Duel',
  11: 'Ranked 2v2 Doubles',
  12: 'Ranked Solo Standard',
  13: 'Ranked 3v3 Standard',
  27: 'Ranked Hoops',
  28: 'Ranked Rumble',
  29: 'Ranked Dropshot',
  30: 'Ranked Snow Day',
  34: 'Tournament Match',
  53: 'Special LTM Mode',
};

export function getMatchPlaylistLabel(playlistId: number | null | undefined, playersCount?: number): string {
  if (playlistId !== null && playlistId !== undefined && PLAYLIST_LABELS[playlistId]) {
    return PLAYLIST_LABELS[playlistId];
  }
  if (playersCount === 4) return 'Casual 2v2 Doubles';
  if (playersCount === 6) return 'Casual 3v3 Standard';
  if (playersCount === 2) return 'Casual 1v1 Duel';
  return 'Casual Match';
}

export function formatArenaName(raw: string | null | undefined): string {
  if (!raw) return 'Standard Pitch';
  const clean = raw.replace(/_p$/i, '');
  const arenaMap: Record<string, string> = {
    UtopiaStadium_Lux: 'Utopia Coliseum (Dusk)',
    UtopiaStadium_Dusk: 'Utopia Coliseum (Dusk)',
    UtopiaStadium_Snow: 'Utopia Coliseum (Snowy)',
    UtopiaStadium: 'Utopia Coliseum',
    UF_Day: 'Utopia Coliseum (Day)',
    TrainStation: 'Urban Central',
    TrainStation_Night: 'Urban Central (Night)',
    TrainStation_Dawn: 'Urban Central (Dawn)',
    Haunted_TrainStation: 'Urban Central (Haunted)',
    Park: 'Beckwith Park',
    Park_Night: 'Beckwith Park (Midnight)',
    Park_Rainy: 'Beckwith Park (Stormy)',
    Stadium: 'DFH Stadium',
    Stadium_Winter: 'DFH Stadium (Snowy)',
    Stadium_Storm: 'DFH Stadium (Stormy)',
    Stadium_Foggy: 'DFH Stadium (Foggy)',
    STADIUM_10A: 'DFH Stadium',
    Underwater: 'Aquadome',
    Underwater_Retro: 'Aquadome (Retro)',
    Wasteland: 'Wasteland',
    Wasteland_Night: 'Wasteland (Night)',
    NeoTokyo: 'Neo Tokyo',
    NeoTokyo_Standard: 'Neo Tokyo (Standard)',
    NeoTokyo_Comic: 'Neo Tokyo (Comic)',
    EuroStadium: 'Mannfield',
    EuroStadium_Dusk: 'Mannfield (Dusk)',
    EuroStadium_Night: 'Mannfield (Night)',
    EuroStadium_Rainy: 'Mannfield (Stormy)',
    EuroStadium_Snow: 'Mannfield (Snowy)',
    Farm: 'Farmstead',
    Farm_Night: 'Farmstead (Night)',
    Farm_Spooky: 'Farmstead (Spooky)',
    Farm_GRS: 'Farmstead',
    SaltyShores: 'Salty Shores',
    SaltyShores_Night: 'Salty Shores (Night)',
    ChampionshipField: 'Champions Field',
    ChampionshipField_Day: 'Champions Field (Day)',
    CS_Day: 'Champions Field (Day)',
    CS_HW: 'Rivals Arena',
    ForbiddenTemple: 'Forbidden Temple',
    ForbiddenTemple_Day: 'Forbidden Temple (Dawn)',
    ForbiddenTemple_FireAndIce: 'Forbidden Temple (Fire & Ice)',
    FF_Dusk: 'Forbidden Temple (Dusk)',
    CHN_Stadium_Day: 'Forbidden Temple (Day)',
    Underwater_GRS: 'Aquadome',
    NeoTokyo_Arcade: 'Neo Tokyo (Arcade)',
    DeadeyeCanyon: 'Deadeye Canyon',
    DeadeyeCanyon_Oasis: 'Deadeye Canyon (Oasis)',
    Outlaw_Oasis: 'Deadeye Canyon (Oasis)',
    SovereignHeights: 'Sovereign Heights',
    mall_day: 'Sovereign Heights (Mall)',
    street: 'Sovereign Heights',
    EstadioVida: 'Estadio Vida',
    Woods: 'Drift Woods',
  };
  return arenaMap[clean] || clean.replace(/_/g, ' ');
}
