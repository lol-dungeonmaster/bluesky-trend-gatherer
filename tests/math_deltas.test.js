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

describe("math_deltas <1m condition", () => {
    it("should display <1m in pos if diff is less than 60s", () => {
        const h0 = { ts: new Date(Date.now() - 30000), trends: [{ topic: "Same", rank: 1 }] };
        const h1 = { ts: new Date(Date.now() - 60000), trends: [{ topic: "Same", rank: 1 }] }; // 30s
        const res = calculateDeltas({ topic: "Same" }, 0, [h0], new Date(Date.now()).toISOString());
        expect(res.timeUnchangedStr).toContain("<1m in pos");
    });
});


describe("math_deltas actor diffing and returning trends", () => {
    it("should identify new and dropped actors", () => {
        const t = { topic: "Alpha", actors: [{ did: "user1" }, { did: "user3" }] };
        const history = [{
            ts: "2026-09-18T10:00:00",
            trends: [
                { topic: "Alpha", actors: [{ did: "user1" }, { did: "user2" }] }
            ]
        }];
        const result = require('../src/math_deltas.js').calculateDeltas(t, 0, history, "2026-09-18 10:05:00");
        expect(result.newActors).toEqual(["user3"]);
        expect(result.droppedActors).toEqual([{ did: "user2" }]);
    });

    it("should suppress New tag for returning trends found deeper in history", () => {
        const t = { topic: "Returning" };
        const history = [
            { ts: "2026-09-18T10:00:00", trends: [{ topic: "Other" }] },
            { ts: "2026-09-18T09:55:00", trends: [{ topic: "Returning" }] }
        ];
        const result = require('../src/math_deltas.js').calculateDeltas(t, 0, history, "2026-09-18 10:05:00");
        expect(result.rankDiffStr).toContain("—");
        expect(result.timeUnchangedStr).toContain("<1m in pos");
    });

    it("should suppress New tag if timeInTop20Ms is much larger than currentGapMs", () => {
        const t = { topic: "Returning", timeInTop20Ms: 600000 };
        const history = [
            { ts: "2026-09-18T10:00:00", trends: [{ topic: "Other" }] }
        ];
        const result = require('../src/math_deltas.js').calculateDeltas(t, 0, history, "2026-09-18 10:05:00");
        expect(result.rankDiffStr).toContain("—");
        expect(result.timeUnchangedStr).toContain("<1m in pos");
    });
});
