import { Sales, ISales } from "../../models/sales.model";
import { PORegister } from "../../models/poRegister.model";
import { DispatchRequestItem } from "./dispatchRequestExtractionService";

export type DispatchMatchStatus = "DISPATCHED" | "PENDING" | "PO_NOT_FOUND";

export interface DispatchLine {
    invoiceNumber: string;
    dispatchDate: Date;
    quantity: number;
    itemCode: string;
    itemName: string;
    transporterName?: string;
    consignmentNumber?: string;
    ewayBillNumber?: string;
}

export interface DispatchMatchResult {
    poNumber: string;
    itemCode: string;
    itemDescription: string;
    status: DispatchMatchStatus;
    orderedQty: number;
    dispatchedQty: number;
    balanceQty: number;
    dispatches: DispatchLine[];
}

function toDispatchLine(sale: ISales): DispatchLine {
    return {
        invoiceNumber: sale.invoiceNumber,
        dispatchDate: sale.dispatchDate,
        quantity: sale.quantity,
        itemCode: sale.itemCode,
        itemName: sale.itemName,
        transporterName: sale.transporterName,
        consignmentNumber: sale.consignmentNumber,
        ewayBillNumber: sale.ewayBillNumber,
    };
}

/**
 * One result per ordered line item on the requested PO (every line when the
 * request didn't name a specific item code) — never a single blanket status
 * for the whole PO, since a PO is routinely shipped in more than one partial
 * lot. orderedQty/dispatchedQty/balanceQty let the draft show exactly what
 * shipped and what's still owed, instead of collapsing a 44-of-100 partial
 * shipment into a bare "DISPATCHED" flag that looks like the order is done.
 * PO_NOT_FOUND is the only case with nothing to report a quantity for.
 */
export async function matchDispatchRequests(
    requests: DispatchRequestItem[]
): Promise<DispatchMatchResult[]> {
    const poNumbers = [...new Set(requests.map(r => r.poNumber))];

    const [salesRecords, poRegisters] = await Promise.all([
        poNumbers.length
            ? Sales.find({ poNumber: { $in: poNumbers }, isDeleted: false }).lean()
            : Promise.resolve([]),
        poNumbers.length
            ? PORegister.find({ corePoNumber: { $in: poNumbers }, isDeleted: false }).lean()
            : Promise.resolve([]),
    ]);

    const salesByPoItem = new Map<string, ISales[]>();
    for (const sale of salesRecords) {
        if (!sale.poNumber) continue;
        const key = `${sale.poNumber}::${sale.itemCode}`;
        const group = salesByPoItem.get(key) || [];
        group.push(sale);
        salesByPoItem.set(key, group);
    }
    const poRegisterByPo = new Map(poRegisters.map(p => [p.corePoNumber, p]));

    const results: DispatchMatchResult[] = [];

    for (const request of requests) {
        const poRegister = poRegisterByPo.get(request.poNumber);

        if (!poRegister) {
            results.push({
                poNumber: request.poNumber,
                itemCode: request.itemCode || "",
                itemDescription: "",
                status: "PO_NOT_FOUND",
                orderedQty: 0,
                dispatchedQty: 0,
                balanceQty: 0,
                dispatches: [],
            });
            continue;
        }

        const orderedItems = request.itemCode
            ? poRegister.items.filter(i => i.itemCode === request.itemCode)
            : poRegister.items;

        for (const item of orderedItems) {
            const salesForItem = salesByPoItem.get(`${request.poNumber}::${item.itemCode}`) || [];
            const dispatchedQty = salesForItem.reduce((sum, s) => sum + (s.quantity || 0), 0);
            const orderedQty = item.quantity;
            const balanceQty = Math.max(orderedQty - dispatchedQty, 0);

            results.push({
                poNumber: request.poNumber,
                itemCode: item.itemCode,
                itemDescription: salesForItem[0]?.itemName || item.itemDescription.split("\n")[0] || "",
                status: dispatchedQty > 0 ? "DISPATCHED" : "PENDING",
                orderedQty,
                dispatchedQty,
                balanceQty,
                dispatches: salesForItem.map(toDispatchLine),
            });
        }
    }

    return results;
}
