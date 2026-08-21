import { matchDispatchRequests } from "../dispatchMatchingService";
import { Sales } from "../../../models/sales.model";
import { PORegister } from "../../../models/poRegister.model";

jest.mock("../../../models/sales.model", () => ({
    Sales: { find: jest.fn() },
}));

jest.mock("../../../models/poRegister.model", () => ({
    PORegister: { find: jest.fn() },
}));

function mockLean<T>(value: T) {
    return { lean: jest.fn().mockResolvedValue(value) };
}

describe("matchDispatchRequests", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("reports a balance when only part of the ordered quantity has shipped", async () => {
        (PORegister.find as jest.Mock).mockReturnValue(
            mockLean([
                {
                    corePoNumber: "4100551198",
                    items: [
                        { itemCode: "2100293525", itemDescription: "STRIPPER NOSE", quantity: 100 },
                    ],
                },
            ])
        );
        (Sales.find as jest.Mock).mockReturnValue(
            mockLean([
                {
                    poNumber: "4100551198",
                    itemCode: "2100293525",
                    itemName: "STRIPPER NOSE",
                    quantity: 44,
                    invoiceNumber: "SE/2627/000055",
                    dispatchDate: new Date("2026-07-24T07:50:00.000Z"),
                },
            ])
        );

        const [result] = await matchDispatchRequests([{ poNumber: "4100551198" }]);

        expect(result).toMatchObject({
            poNumber: "4100551198",
            itemCode: "2100293525",
            status: "DISPATCHED",
            orderedQty: 100,
            dispatchedQty: 44,
            balanceQty: 56,
        });
        expect(result?.dispatches).toHaveLength(1);
    });

    it("sums multiple partial shipments against the ordered quantity", async () => {
        (PORegister.find as jest.Mock).mockReturnValue(
            mockLean([
                {
                    corePoNumber: "PO1",
                    items: [{ itemCode: "ITM1", itemDescription: "WIDGET", quantity: 100 }],
                },
            ])
        );
        (Sales.find as jest.Mock).mockReturnValue(
            mockLean([
                {
                    poNumber: "PO1",
                    itemCode: "ITM1",
                    itemName: "WIDGET",
                    quantity: 30,
                    invoiceNumber: "INV1",
                    dispatchDate: new Date(),
                },
                {
                    poNumber: "PO1",
                    itemCode: "ITM1",
                    itemName: "WIDGET",
                    quantity: 20,
                    invoiceNumber: "INV2",
                    dispatchDate: new Date(),
                },
            ])
        );

        const [result] = await matchDispatchRequests([{ poNumber: "PO1" }]);

        expect(result?.dispatchedQty).toBe(50);
        expect(result?.balanceQty).toBe(50);
        expect(result?.dispatches).toHaveLength(2);
    });

    it("marks a fully dispatched item with zero balance", async () => {
        (PORegister.find as jest.Mock).mockReturnValue(
            mockLean([
                {
                    corePoNumber: "PO2",
                    items: [{ itemCode: "ITM2", itemDescription: "GASKET", quantity: 10 }],
                },
            ])
        );
        (Sales.find as jest.Mock).mockReturnValue(
            mockLean([
                {
                    poNumber: "PO2",
                    itemCode: "ITM2",
                    itemName: "GASKET",
                    quantity: 10,
                    invoiceNumber: "INV3",
                    dispatchDate: new Date(),
                },
            ])
        );

        const [result] = await matchDispatchRequests([{ poNumber: "PO2" }]);

        expect(result?.status).toBe("DISPATCHED");
        expect(result?.balanceQty).toBe(0);
    });

    it("marks an item with nothing shipped as PENDING with the full ordered qty as balance", async () => {
        (PORegister.find as jest.Mock).mockReturnValue(
            mockLean([
                {
                    corePoNumber: "PO3",
                    items: [{ itemCode: "ITM3", itemDescription: "BOLT", quantity: 25 }],
                },
            ])
        );
        (Sales.find as jest.Mock).mockReturnValue(mockLean([]));

        const [result] = await matchDispatchRequests([{ poNumber: "PO3" }]);

        expect(result).toMatchObject({
            status: "PENDING",
            dispatchedQty: 0,
            orderedQty: 25,
            balanceQty: 25,
        });
        expect(result?.dispatches).toHaveLength(0);
    });

    it("returns PO_NOT_FOUND when the PO isn't registered at all", async () => {
        (PORegister.find as jest.Mock).mockReturnValue(mockLean([]));
        (Sales.find as jest.Mock).mockReturnValue(mockLean([]));

        const [result] = await matchDispatchRequests([{ poNumber: "UNKNOWN" }]);

        expect(result).toMatchObject({ status: "PO_NOT_FOUND", poNumber: "UNKNOWN" });
    });

    it("scopes to a single item when the request names an itemCode on a multi-item PO", async () => {
        (PORegister.find as jest.Mock).mockReturnValue(
            mockLean([
                {
                    corePoNumber: "PO4",
                    items: [
                        { itemCode: "A", itemDescription: "ITEM A", quantity: 5 },
                        { itemCode: "B", itemDescription: "ITEM B", quantity: 8 },
                    ],
                },
            ])
        );
        (Sales.find as jest.Mock).mockReturnValue(mockLean([]));

        const results = await matchDispatchRequests([{ poNumber: "PO4", itemCode: "B" }]);

        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({ itemCode: "B", orderedQty: 8 });
    });
});
