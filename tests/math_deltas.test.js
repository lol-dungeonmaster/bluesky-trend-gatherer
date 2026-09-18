const { calculateDeltas } = require('../src/math_deltas.js');

describe("Math Deltas", () => {
    const currentMomentTsStr = "2026-09-18 10:05:00";
    
    it("should return New tag if history is empty", () => {
        const t = { topic: "Alpha" };
        const result = calculateDeltas(t, 0, [], currentMomentTsStr);
        expect(result.rankDiffStr).toContain("New");
    });

    it("should calculate positive rank and post/actor deltas", () => {
        const t = { topic: "Alpha", postCount: 1500, actors: [1,2,3] }; // Current rank 1
        const history = [{
            ts: new Date("2026-09-18T10:00:00"),
            trends: [
                { topic: "Beta", postCount: 1000 },
                { topic: "Alpha", postCount: 1000, actors: [1] } // Prev rank 2
            ]
        }];

        const result = calculateDeltas(t, 0, history, currentMomentTsStr);
        expect(result.rankDiffStr).toContain("▲1");
        expect(result.pcDiffStr).toContain("(+500)");
        expect(result.acDiffStr).toContain("(+2)");
    });

    it("should calculate negative rank and post/actor deltas", () => {
        const t = { topic: "Beta", postCount: 900, actors: [] }; // Current rank 2
        const history = [{
            ts: new Date("2026-09-18T10:00:00"),
            trends: [
                { topic: "Beta", postCount: 1000, actors: [1] }, // Prev rank 1
                { topic: "Alpha", postCount: 500 } 
            ]
        }];

        const result = calculateDeltas(t, 1, history, currentMomentTsStr);
        expect(result.rankDiffStr).toContain("▼1");
        expect(result.pcDiffStr).toContain("(-100)");
        expect(result.acDiffStr).toContain("(-1)");
    });

    it("should return time in pos for unchanged rank", () => {
        const t = { topic: "Alpha" }; // rank 1
        const history = [
            { ts: new Date("2026-09-18T10:00:00"), trends: [{ topic: "Alpha" }] }, // 5 mins ago
            { ts: new Date("2026-09-18T09:55:00"), trends: [{ topic: "Alpha" }] }, // 10 mins ago
            { ts: new Date("2026-09-18T09:50:00"), trends: [{ topic: "Beta" }, { topic: "Alpha" }] } // Rank was 2 here
        ];

        const result = calculateDeltas(t, 0, history, currentMomentTsStr);
        expect(result.rankDiffStr).toContain("—");
        expect(result.timeUnchangedStr).toContain("10m in pos");
    });
});
