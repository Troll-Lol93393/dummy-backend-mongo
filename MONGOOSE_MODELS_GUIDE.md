# Mongoose Models Complete Guide

## Table of Contents
1. [Basic Schema Definition](#basic-schema-definition)
2. [Schema Types](#schema-types)
3. [Schema Options](#schema-options)
4. [Middleware (Hooks)](#middleware-hooks)
5. [Instance Methods](#instance-methods)
6. [Static Methods](#static-methods)
7. [Virtual Properties](#virtual-properties)
8. [Indexes](#indexes)
9. [Validation](#validation)
10. [TypeScript Integration](#typescript-integration)

---

## Basic Schema Definition

### Structure
```typescript
import mongoose, { Schema } from "mongoose";

// 1. Define Interface (TypeScript)
export interface IUser {
    userName: string;
    email: string;
    password: string;
    // ... other properties
    // Instance methods
    comparePassword(password: string): Promise<boolean>;
    generateAccessToken(): string;
}

// 2. Define Schema
export const userSchema: Schema<IUser> = new Schema<IUser>(
    {
        // field definitions
    },
    {
        // schema options
    }
);

// 3. Add middleware, methods, etc.
// 4. Create and export model
export const User = mongoose.model<IUser>("User", userSchema);
```

---

## Schema Types

### Basic Types
```typescript
{
    stringField: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        unique: true
    },
    numberField: {
        type: Number,
        min: 0,
        max: 100,
        default: 0
    },
    booleanField: {
        type: Boolean,
        default: false
    },
    dateField: {
        type: Date,
        default: Date.now
    },
    arrayField: {
        type: [String], // Array of strings
        default: []
    },
    objectField: {
        type: {
            name: String,
            age: Number
        }
    }
}
```

### Advanced Types
```typescript
{
    enumField: {
        type: String,
        enum: ["ACTIVE", "INACTIVE", "PENDING"],
        default: "PENDING"
    },
    refField: {
        type: Schema.Types.ObjectId,
        ref: "User" // References another model
    },
    mixedField: {
        type: Schema.Types.Mixed // Can store any type
    },
    bufferField: {
        type: Schema.Types.Buffer // For binary data
    }
}
```

---

## Schema Options

### Common Options
```typescript
{
    timestamps: true, // Adds createdAt and updatedAt
    collection: "custom_collection_name", // Custom collection name
    strict: true, // Only save fields defined in schema
    versionKey: false, // Disable __v field
    toJSON: { virtuals: true }, // Include virtuals when converting to JSON
    toObject: { virtuals: true }
}
```

---

## Middleware (Hooks)

### Pre/Post Hooks
Middleware functions that run before/after specific operations.

#### Pre-Save Hook (Password Hashing Example)
```typescript
// Runs BEFORE saving document
userSchema.pre("save", async function (next) {
    // 'this' refers to the document being saved
    if (!this.isModified("password")) return next();
    
    if (!this.password) {
        return next(new Error("Password is required"));
    }
    
    // Hash password before saving
    this.password = await bcrypt.hash(this.password, 10);
    next(); // Continue with save operation
});
```

#### Post-Save Hook
```typescript
// Runs AFTER saving document
userSchema.post("save", function(doc, next) {
    console.log("User saved:", doc.userName);
    next();
});
```

### Available Hook Types
- **Document Hooks**: `save`, `remove`, `update`, `deleteOne`, `deleteMany`
- **Query Hooks**: `find`, `findOne`, `findOneAndUpdate`, `findOneAndDelete`
- **Aggregate Hooks**: `aggregate`

### Hook Execution Order
1. Pre-hooks (in order of registration)
2. Operation (save, find, etc.)
3. Post-hooks (in order of registration)

---

## Instance Methods

Methods that are available on individual document instances.

### Definition
```typescript
// Add methods to schema
userSchema.methods.comparePassword = async function (password: string) {
    return await bcrypt.compare(password, this.password);
};

userSchema.methods.generateAccessToken = function () {
    return jwt.sign(
        {
            _id: this._id,
            email: this.email,
            userName: this.userName,
        },
        process.env.ACCESS_TOKEN_SECRET as string,
        {
            expiresIn: Number(process.env.ACCESS_TOKEN_EXPIRY) || 3600,
            algorithm: "HS256"
        }
    );
};
```

### Usage
```typescript
const user = await User.findById(userId);
const isValid = await user.comparePassword(password);
const token = user.generateAccessToken();
```

### TypeScript Interface
```typescript
export interface IUser {
    // ... properties
    comparePassword(password: string): Promise<boolean>;
    generateAccessToken(): string;
}
```

---

## Static Methods

Methods that are available on the model itself (not instances).

### Definition
```typescript
userSchema.statics.findByEmail = function(email: string) {
    return this.findOne({ email });
};

userSchema.statics.createUser = function(userData: Partial<IUser>) {
    return this.create(userData);
};
```

### Usage
```typescript
const user = await User.findByEmail("user@example.com");
const newUser = await User.createUser({ userName: "john", email: "john@example.com" });
```

---

## Virtual Properties

Properties that are computed and not stored in the database.

### Definition
```typescript
userSchema.virtual("fullName").get(function() {
    return `${this.firstName} ${this.lastName}`;
});

userSchema.virtual("fullName").set(function(name: string) {
    const parts = name.split(" ");
    this.firstName = parts[0];
    this.lastName = parts[1];
});
```

### Usage
```typescript
const user = await User.findById(userId);
console.log(user.fullName); // "John Doe"
user.fullName = "Jane Smith"; // Sets firstName and lastName
```

---

## Indexes

### Single Field Index
```typescript
{
    email: {
        type: String,
        unique: true,
        index: true // Creates index on email field
    }
}
```

### Compound Index
```typescript
userSchema.index({ email: 1, userName: 1 });
userSchema.index({ createdAt: -1 }); // Descending index
```

### Text Index (for search)
```typescript
userSchema.index({ firstName: "text", lastName: "text" });
```

---

## Validation

### Built-in Validators
```typescript
{
    email: {
        type: String,
        required: [true, "Email is required"],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, "Invalid email format"]
    },
    age: {
        type: Number,
        min: [0, "Age cannot be negative"],
        max: [120, "Age cannot exceed 120"]
    }
}
```

### Custom Validators
```typescript
{
    quotedOn: {
        type: Date,
        required: function(this: IRfq) {
            return this.isQuoted === true;
        },
        validate: {
            validator: function(this: IRfq, value: Date) {
                if (this.isQuoted && !value) {
                    return false;
                }
                return true;
            },
            message: 'Quoted date is required when PR is quoted'
        }
    }
}
```

### Async Validators
```typescript
{
    email: {
        type: String,
        validate: {
            validator: async function(email: string) {
                const user = await User.findOne({ email });
                return !user; // Return false if email already exists
            },
            message: "Email already exists"
        }
    }
}
```

---

## TypeScript Integration

### Interface Definition
```typescript
export interface IUser {
    _id?: string;
    userName: string;
    email: string;
    firstName: string;
    lastName: string;
    password: string;
    role: string;
    refreshToken?: string;
    createdAt?: Date;
    updatedAt?: Date;
    
    // Instance methods
    comparePassword(password: string): Promise<boolean>;
    generateAccessToken(): string;
    generateRefreshToken(): string;
}
```

### Schema with TypeScript
```typescript
export const userSchema: Schema<IUser> = new Schema<IUser>(
    {
        // field definitions
    },
    {
        timestamps: true,
    }
);
```

### Model Creation
```typescript
export const User = mongoose.model<IUser>("User", userSchema);
```

---

## Best Practices

### 1. Always Use TypeScript Interfaces
```typescript
// Define interface first
export interface IProduct {
    name: string;
    price: number;
    category: string;
}

// Use in schema
export const productSchema: Schema<IProduct> = new Schema<IProduct>({...});
```

### 2. Use Proper Error Handling in Middleware
```typescript
userSchema.pre("save", async function (next) {
    try {
        if (!this.isModified("password")) return next();
        this.password = await bcrypt.hash(this.password, 10);
        next();
    } catch (error) {
        next(error);
    }
});
```

### 3. Validate Data Before Saving
```typescript
userSchema.pre("save", function(next) {
    if (!this.email || !this.userName) {
        return next(new Error("Email and username are required"));
    }
    next();
});
```

### 4. Use Indexes Wisely
```typescript
// Index frequently queried fields
userSchema.index({ email: 1 });
userSchema.index({ userName: 1 });
userSchema.index({ createdAt: -1 }); // For sorting by date
```

### 5. Handle Async Operations Properly
```typescript
// Always await async operations in middleware
userSchema.pre("save", async function(next) {
    if (this.isModified("email")) {
        const existingUser = await User.findOne({ email: this.email });
        if (existingUser) {
            return next(new Error("Email already exists"));
        }
    }
    next();
});
```

---

## Common Patterns

### 1. Soft Delete
```typescript
{
    isDeleted: {
        type: Boolean,
        default: false
    }
}

// Add to queries
userSchema.pre("find", function() {
    this.where({ isDeleted: { $ne: true } });
});
```

### 2. Audit Trail
```typescript
{
    createdBy: {
        type: Schema.Types.ObjectId,
        ref: "User"
    },
    updatedBy: {
        type: Schema.Types.ObjectId,
        ref: "User"
    }
}
```

### 3. Version Control
```typescript
{
    version: {
        type: Number,
        default: 1
    }
}

userSchema.pre("save", function(next) {
    this.version += 1;
    next();
});
```

This guide covers all the essential concepts you need to work effectively with Mongoose models in TypeScript! 