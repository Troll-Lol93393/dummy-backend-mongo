import { User } from "../models/user.model";
import { logger } from "../utils/logger";

/**
 * Seed a default admin user if none exists.
 * Runs on every server start — skips if the account already exists.
 */
export async function seedDefaultAdmin(): Promise<void> {
    const email = "shethengg@gmail.com";

    try {
        const exists = await User.findOne({ email }).select("_id").lean();
        if (exists) return;

        await User.create({
            userName: "shethadmin",
            email,
            firstName: "Sheth",
            middleName: "",
            lastName: "Admin",
            phoneNumber: "",
            role: "ROLE_OWNER",
            password: "Password@123",
        });

        logger.info("SEED", `Default admin account created: ${email}`);
    } catch (err) {
        // Duplicate key (race condition) is fine — means it already exists
        if (err && typeof err === "object" && "code" in err && (err as { code: number }).code === 11000) {
            return;
        }
        logger.error("SEED", "Failed to seed default admin", { error: String(err) });
    }
}
