export const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

export const validatePassword = (password: string): { isValid: boolean; message?: string } => {
    if (password.length < 8) {
        return { isValid: false, message: "Password must be at least 8 characters long" };
    }
    
    if (!/(?=.*[a-z])/.test(password)) {
        return { isValid: false, message: "Password must contain at least one lowercase letter" };
    }
    
    if (!/(?=.*[A-Z])/.test(password)) {
        return { isValid: false, message: "Password must contain at least one uppercase letter" };
    }
    
    if (!/(?=.*\d)/.test(password)) {
        return { isValid: false, message: "Password must contain at least one number" };
    }
    
    return { isValid: true };
};

export const validateUserName = (userName: string): { isValid: boolean; message?: string } => {
    if (userName.length < 3) {
        return { isValid: false, message: "Username must be at least 3 characters long" };
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(userName)) {
        return { isValid: false, message: "Username can only contain letters, numbers, and underscores" };
    }
    
    return { isValid: true };
};

export const validatePhoneNumber = (phoneNumber: string): { isValid: boolean; message?: string } => {
    const phoneRegex = /^\+?[\d\s\-\(\)]{10,}$/;
    
    if (!phoneRegex.test(phoneNumber)) {
        return { isValid: false, message: "Please enter a valid phone number" };
    }
    
    return { isValid: true };
};

export const sanitizeInput = (input: string): string => {
    return input.trim().replace(/[<>]/g, '');
}; 