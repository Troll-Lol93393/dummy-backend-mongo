import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { Client } from "../models/client.model";

export const getAllClients = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const all = req.query.all as string;

        // Return all non-deleted clients for dropdowns
        if (all === "true") {
            const clients = await Client.find({ isDeleted: false }).sort({ companyName: 1 }).lean();

            res.status(200).json(new ApiResponse(200, clients, "Clients fetched successfully"));
            return;
        }

        const page = parseInt(req.query.page as string) || 1;
        const size = parseInt(req.query.size as string) || 10;
        const search = (req.query.search as string) || "";
        const sortBy = (req.query.sortBy as string) || "companyName";
        const sortOrder = (req.query.sortOrder as string) === "desc" ? -1 : 1;

        const filter: Record<string, unknown> = { isDeleted: false };

        if (search) {
            filter.$or = [
                { companyName: { $regex: search, $options: "i" } },
                { gstn: { $regex: search, $options: "i" } },
                { city: { $regex: search, $options: "i" } },
            ];
        }

        const allowedSortFields = [
            "companyName",
            "gstn",
            "location",
            "city",
            "state",
            "buyerName",
            "createdAt",
        ];
        const sortField = allowedSortFields.includes(sortBy) ? sortBy : "companyName";

        const totalCount = await Client.countDocuments(filter);
        const clients = await Client.find(filter)
            .sort({ [sortField]: sortOrder })
            .skip((page - 1) * size)
            .limit(size)
            .lean();

        res.status(200).json(
            new ApiResponse(
                200,
                {
                    data: clients,
                    totalCount,
                    page,
                    size,
                    totalPages: Math.ceil(totalCount / size),
                },
                "Clients fetched successfully"
            )
        );
    }
);

export const getClientById = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params;
        const client = await Client.findOne({ _id: id, isDeleted: false });

        if (!client) {
            throw new ApiError(404, "Client not found");
        }

        res.status(200).json(new ApiResponse(200, client, "Client fetched successfully"));
    }
);

export const createClient = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const {
            companyName,
            gstn,
            location,
            addressLine1,
            addressLine2,
            addressLine3,
            state,
            city,
            pincode,
            country,
            buyerName,
            buyerContact,
        } = req.body;

        if (!companyName || companyName.trim() === "") {
            throw new ApiError(400, "Company name is required");
        }

        // Check uniqueness among non-deleted clients
        const existing = await Client.findOne({
            companyName: companyName.trim(),
            isDeleted: false,
        });
        if (existing) {
            throw new ApiError(409, "A client with this company name already exists");
        }

        const newClient = await Client.create({
            companyName,
            gstn,
            location,
            addressLine1,
            addressLine2,
            addressLine3,
            state,
            city,
            pincode,
            country,
            buyerName,
            buyerContact,
            isDeleted: false,
        });

        res.status(201).json(new ApiResponse(201, newClient, "Client created successfully"));
    }
);

export const updateClient = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params;
        const {
            companyName,
            gstn,
            location,
            addressLine1,
            addressLine2,
            addressLine3,
            state,
            city,
            pincode,
            country,
            buyerName,
            buyerContact,
        } = req.body;

        const client = await Client.findOne({ _id: id, isDeleted: false });
        if (!client) {
            throw new ApiError(404, "Client not found");
        }

        // Check companyName uniqueness if changed
        if (companyName !== undefined && companyName.trim() !== client.companyName) {
            const existing = await Client.findOne({
                companyName: companyName.trim(),
                isDeleted: false,
                _id: { $ne: id },
            });
            if (existing) {
                throw new ApiError(409, "A client with this company name already exists");
            }
        }

        if (companyName !== undefined) client.companyName = companyName;
        if (gstn !== undefined) client.gstn = gstn;
        if (location !== undefined) client.location = location;
        if (addressLine1 !== undefined) client.addressLine1 = addressLine1;
        if (addressLine2 !== undefined) client.addressLine2 = addressLine2;
        if (addressLine3 !== undefined) client.addressLine3 = addressLine3;
        if (state !== undefined) client.state = state;
        if (city !== undefined) client.city = city;
        if (pincode !== undefined) client.pincode = pincode;
        if (country !== undefined) client.country = country;
        if (buyerName !== undefined) client.buyerName = buyerName;
        if (buyerContact !== undefined) client.buyerContact = buyerContact;

        await client.save();

        res.status(200).json(new ApiResponse(200, client, "Client updated successfully"));
    }
);

export const deleteClient = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params;
        const client = await Client.findByIdAndUpdate(id, { isDeleted: true }, { new: true });

        if (!client) {
            throw new ApiError(404, "Client not found");
        }

        res.status(200).json(new ApiResponse(200, client, "Client deleted successfully"));
    }
);
