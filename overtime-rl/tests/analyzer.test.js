import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchAnalyzer } from '../src/server/models/analyzer.ts';
import { GrindlogReader } from '../src/server/ingestion/grindlog-reader.ts';
test('MatchAnalyzer - should analyze real historical match from Grindlog', () => {
    const reader = new GrindlogReader();
    if (!reader.isAvailable()) {
        console.log('Grindlog tracker.db not found on this machine, skipping live test');
        return;
    }
    const recent = reader.getRecentMatches(1);
    assert.ok(recent.length > 0, 'Expected at least 1 match in Grindlog');
    const targetGuid = recent[0].guid;
    const analyzer = new MatchAnalyzer(reader);
    const start = performance.now();
    const analysis = analyzer.analyzeMatch(targetGuid, true);
    const elapsed = performance.now() - start;
    console.log(`Analyzed match ${targetGuid} in ${elapsed.toFixed(1)} ms`);
    assert.ok(analysis !== null, 'Expected non-null match analysis');
    assert.equal(analysis.guid, targetGuid);
    assert.ok(analysis.players.length > 0, 'Expected players to be analyzed');
    assert.ok(analysis.momentum.length > 0, 'Expected momentum wave buckets');
    for (const p of analysis.players) {
        assert.ok(p.rating >= 1.0 && p.rating <= 10.0, `Player rating ${p.rating} out of range [1.0, 10.0]`);
        assert.ok(p.radar.finishing >= 10 && p.radar.finishing <= 99);
        assert.ok(p.radar.archetype.length > 0);
    }
    console.log('Sample player analysis:', {
        name: analysis.players[0].name,
        rating: analysis.players[0].rating,
        xg: analysis.players[0].xg,
        archetype: analysis.players[0].radar.archetype,
        potm: analysis.awards.player_of_the_match,
    });
});
