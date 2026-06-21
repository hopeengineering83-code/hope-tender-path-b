import { test } from "node:test";
import assert from "node:assert";

test("Grounding logic simulation", () => {
    const mandatoryReqs = [
        { priority: "MANDATORY", sourceTenderFileId: "1", sourcePage: 1, sourceQuote: "quote" },
        { priority: "MANDATORY", sourceTenderFileId: "1", sourcePage: 1, sourceQuote: null }
    ];

    const invalidMandatory = mandatoryReqs.filter((r: any) => {
        const hasId = r.sourceTenderFileId || r.sourceFileToken;
        return !hasId || !r.sourcePage || !r.sourceQuote;
    });

    assert.strictEqual(invalidMandatory.length, 1, "Should detect one invalid mandatory requirement");
});
