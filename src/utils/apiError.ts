interface ApiError extends Error {
    statusCode: number;
    message: string;
    success: boolean;
    errors: string[];
}

class ApiError extends Error {
    constructor(
        statusCode: number,
        message: string = "Something went wrong",
        errors: string[] = [],
        stack: string = ""
    ){
        super(message)
        this.statusCode = statusCode
        this.message = message
        this.success = false;
        this.errors = errors

        if (stack) {
            this.stack = stack
        } else{
            Error.captureStackTrace(this, this.constructor)
        }

    }
}

export {ApiError}