import { generateDispatchStatusDraftHtml } from "../dispatchDraftGenerationService";
import { DispatchMatchResult } from "../dispatchMatchingService";

function makeResult(overrides: Partial<DispatchMatchResult>): DispatchMatchResult {
    return {
        poNumber: "PO",
        itemCode: "ITM",
        itemDescription: "ITEM",
        status: "PENDING",
        orderedQty: 0,
        dispatchedQty: 0,
        balanceQty: 0,
        dispatches: [],
        ...overrides,
    };
}

describe("generateDispatchStatusDraftHtml", () => {
    it("shows both the dispatched line and the balance placeholder for a partial shipment", () => {
        const html = generateDispatchStatusDraftHtml([
            makeResult({
                poNumber: "4100551198",
                itemCode: "2100293525",
                itemDescription: "STRIPPER NOSE",
                status: "DISPATCHED",
                orderedQty: 100,
                dispatchedQty: 44,
                balanceQty: 56,
                dispatches: [
                    {
                        invoiceNumber: "SE/2627/000055",
                        dispatchDate: new Date("2026-07-24T07:50:00.000Z"),
                        quantity: 44,
                        itemCode: "2100293525",
                        itemName: "STRIPPER NOSE",
                        transporterName: "ABC Transport",
                        consignmentNumber: "CN123",
                    },
                ],
            }),
        ]);

        expect(html).toContain("ABC Transport");
        expect(html).toContain("Dispatched");
        expect(html).toContain("Balance quantity of 56 nos is under manufacturing");
        expect(html).toContain("Pending");
    });

    it("shows only the placeholder row when nothing has shipped", () => {
        const html = generateDispatchStatusDraftHtml([
            makeResult({
                poNumber: "PO3",
                itemCode: "ITM3",
                itemDescription: "BOLT",
                orderedQty: 25,
                balanceQty: 25,
            }),
        ]);

        expect(html).toContain("Balance quantity of 25 nos is under manufacturing");
        expect(html).not.toContain("Dispatched<");
    });

    it("shows no balance row for a fully dispatched item", () => {
        const html = generateDispatchStatusDraftHtml([
            makeResult({
                status: "DISPATCHED",
                orderedQty: 10,
                dispatchedQty: 10,
                balanceQty: 0,
                dispatches: [
                    {
                        invoiceNumber: "INV1",
                        dispatchDate: new Date(),
                        quantity: 10,
                        itemCode: "ITM",
                        itemName: "ITEM",
                    },
                ],
            }),
        ]);

        expect(html).not.toContain("under manufacturing");
    });

    it("renders the not-found row for an unknown PO", () => {
        const html = generateDispatchStatusDraftHtml([
            makeResult({ poNumber: "UNKNOWN", status: "PO_NOT_FOUND" }),
        ]);

        expect(html).toContain("PO not found in our records");
    });
});
