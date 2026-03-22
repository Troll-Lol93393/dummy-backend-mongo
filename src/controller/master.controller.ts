import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { RawMaterialType } from "../models/rawMaterialType.model";
import { LabourProcessType } from "../models/labourProcessType.model";

// ===================== Raw Material Type =====================

export const createRawMaterialType = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { name, description } = req.body;

        if (!name || name.trim() === "") {
            throw new ApiError(400, "Raw material type name is required");
        }

        const existing = await RawMaterialType.findOne({ name, isDeleted: false });

        if (existing) {
            throw new ApiError(400, "Raw material type already exists");
        }

        const rawMaterialType = await RawMaterialType.create({
            name,
            description: description ?? "",
        });

        res.status(201).json(
            new ApiResponse(201, rawMaterialType, "Raw material type created successfully !")
        );
    }
);

export const getAllRawMaterialTypes = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const page = parseInt(req.query.page as string) || 1;
        const size = parseInt(req.query.size as string) || 10;
        const search = (req.query.search as string) || "";
        const sortBy = (req.query.sortBy as string) || "createdAt";
        const sortOrder = (req.query.sortOrder as string) === "asc" ? 1 : -1;

        const filter: Record<string, unknown> = { isDeleted: false };
        if (search) {
            filter.name = { $regex: search, $options: "i" };
        }

        const totalCount = await RawMaterialType.countDocuments(filter);
        const rawMaterialTypes = await RawMaterialType.find(filter)
            .sort({ [sortBy]: sortOrder })
            .skip((page - 1) * size)
            .limit(size);

        res.status(200).json(
            new ApiResponse(200, {
                data: rawMaterialTypes,
                totalCount,
                page,
                size,
                totalPages: Math.ceil(totalCount / size),
            }, "Raw material types fetched successfully !")
        );
    }
);

export const updateRawMaterialType = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params;
        const { name, description } = req.body;

        const rawMaterialType = await RawMaterialType.findOne({
            _id: id,
            isDeleted: false,
        });

        if (!rawMaterialType) {
            throw new ApiError(404, "Raw material type not found");
        }

        if (name !== undefined) rawMaterialType.name = name;
        if (description !== undefined) rawMaterialType.description = description;

        await rawMaterialType.save();

        res.status(200).json(
            new ApiResponse(200, rawMaterialType, "Raw material type updated successfully !")
        );
    }
);

export const deleteRawMaterialType = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params;

        const rawMaterialType = await RawMaterialType.findOne({
            _id: id,
            isDeleted: false,
        });

        if (!rawMaterialType) {
            throw new ApiError(404, "Raw material type not found");
        }

        rawMaterialType.isDeleted = true;
        await rawMaterialType.save();

        res.status(200).json(
            new ApiResponse(200, rawMaterialType, "Raw material type soft deleted successfully !")
        );
    }
);

// ===================== Labour Process Type =====================

export const createLabourProcessType = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { name, description } = req.body;

        if (!name || name.trim() === "") {
            throw new ApiError(400, "Labour process type name is required");
        }

        const existing = await LabourProcessType.findOne({ name, isDeleted: false });

        if (existing) {
            throw new ApiError(400, "Labour process type already exists");
        }

        const labourProcessType = await LabourProcessType.create({
            name,
            description: description ?? "",
        });

        res.status(201).json(
            new ApiResponse(201, labourProcessType, "Labour process type created successfully !")
        );
    }
);

export const getAllLabourProcessTypes = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const page = parseInt(req.query.page as string) || 1;
        const size = parseInt(req.query.size as string) || 10;
        const search = (req.query.search as string) || "";
        const sortBy = (req.query.sortBy as string) || "createdAt";
        const sortOrder = (req.query.sortOrder as string) === "asc" ? 1 : -1;

        const filter: Record<string, unknown> = { isDeleted: false };
        if (search) {
            filter.name = { $regex: search, $options: "i" };
        }

        const totalCount = await LabourProcessType.countDocuments(filter);
        const labourProcessTypes = await LabourProcessType.find(filter)
            .sort({ [sortBy]: sortOrder })
            .skip((page - 1) * size)
            .limit(size);

        res.status(200).json(
            new ApiResponse(200, {
                data: labourProcessTypes,
                totalCount,
                page,
                size,
                totalPages: Math.ceil(totalCount / size),
            }, "Labour process types fetched successfully !")
        );
    }
);

export const updateLabourProcessType = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params;
        const { name, description } = req.body;

        const labourProcessType = await LabourProcessType.findOne({
            _id: id,
            isDeleted: false,
        });

        if (!labourProcessType) {
            throw new ApiError(404, "Labour process type not found");
        }

        if (name !== undefined) labourProcessType.name = name;
        if (description !== undefined) labourProcessType.description = description;

        await labourProcessType.save();

        res.status(200).json(
            new ApiResponse(200, labourProcessType, "Labour process type updated successfully !")
        );
    }
);

export const deleteLabourProcessType = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params;

        const labourProcessType = await LabourProcessType.findOne({
            _id: id,
            isDeleted: false,
        });

        if (!labourProcessType) {
            throw new ApiError(404, "Labour process type not found");
        }

        labourProcessType.isDeleted = true;
        await labourProcessType.save();

        res.status(200).json(
            new ApiResponse(
                200,
                labourProcessType,
                "Labour process type soft deleted successfully !"
            )
        );
    }
);
