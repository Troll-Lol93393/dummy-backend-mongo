import { Sales, ISales } from "../../models/sales.model";
import { PORegister } from "../../models/poRegister.model";
import { DispatchRequestItem } from "./dispatchRequestExtractionService";

export type DispatchMatchStatus = "DISPATCHED" | "NOT_YET_DISPATCHED" | "PO_NOT_FOUND";

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

export interface OrderedLine {
    itemCode: string;
    itemDescription: string;
    quantity: number;
}

export interface DispatchMatchResult {
    poNumber: string;
    itemCode?: string;
    status: DispatchMatchStatus;
    dispatches: DispatchLine[];
    orderedItems?: OrderedLine[];
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
 * Three-bucket outcome per request line: DISPATCHED (found in Sales — the
 * shipment already went out), NOT_YET_DISPATCHED (PO exists but nothing
 * shipped against it yet, per-item granularity when an item code was given),
 * or PO_NOT_FOUND (PO isn't registered at all — a data-entry question, not
 * a dispatch question).
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
            ? PORegister.find({ poNumber: { $in: poNumbers }, isDeleted: false }).lean()
            : Promise.resolve([]),
    ]);

    const salesByPo = new Map<string, ISales[]>();
    for (const sale of salesRecords) {
        if (!sale.poNumber) continue;
        const group = salesByPo.get(sale.poNumber) || [];
        group.push(sale);
        salesByPo.set(sale.poNumber, group);
    }
    const poRegisterByPo = new Map(poRegisters.map(p => [p.poNumber, p]));

    return requests.map(request => {
        const salesForPo = salesByPo.get(request.poNumber) || [];
        const salesForRequest = request.itemCode
            ? salesForPo.filter(s => s.itemCode === request.itemCode)
            : salesForPo;

        if (salesForRequest.length > 0) {
            return {
                poNumber: request.poNumber,
                itemCode: request.itemCode,
                status: "DISPATCHED",
                dispatches: salesForRequest.map(toDispatchLine),
            };
        }

        const poRegister = poRegisterByPo.get(request.poNumber);
        if (poRegister) {
            const orderedItems = request.itemCode
                ? poRegister.items.filter(i => i.itemCode === request.itemCode)
                : poRegister.items;
            return {
                poNumber: request.poNumber,
                itemCode: request.itemCode,
                status: "NOT_YET_DISPATCHED",
                dispatches: [],
                orderedItems: orderedItems.map(i => ({
                    itemCode: i.itemCode,
                    itemDescription: i.itemDescription,
                    quantity: i.quantity,
                })),
            };
        }

        return {
            poNumber: request.poNumber,
            itemCode: request.itemCode,
            status: "PO_NOT_FOUND",
            dispatches: [],
        };
    });
}
