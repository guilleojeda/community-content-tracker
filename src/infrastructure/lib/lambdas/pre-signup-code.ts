export const preSignupLambdaSource = `
const AWS = require('aws-sdk');
const cognito = new AWS.CognitoIdentityServiceProvider();

exports.handler = async (event, context, callback) => {
    console.log('Pre-signup trigger event:', JSON.stringify(event, null, 2));

    try {
        const { userAttributes } = event.request;
        const customUsername = userAttributes['custom:username'];

        // Validate username format
        if (customUsername) {
            // Username validation rules:
            // - 3-50 characters
            // - Alphanumeric and underscores only
            // - Must start with letter
            const usernameRegex = /^[a-zA-Z][a-zA-Z0-9_]{2,49}$/;

            if (!usernameRegex.test(customUsername)) {
                const error = new Error('Username must be 3-50 characters, start with a letter, and contain only letters, numbers, and underscores');
                error.name = 'InvalidParameterException';
                throw error;
            }

            // Check for username uniqueness
            // Note: In production, this would query the database
            // For now, we'll just validate format
            console.log('Username validation passed for:', customUsername);
        }

        // Validate default_visibility
        const defaultVisibility = userAttributes['custom:default_visibility'];
        if (defaultVisibility) {
            const validVisibilities = ['private', 'aws_only', 'aws_community', 'public'];
            if (!validVisibilities.includes(defaultVisibility)) {
                const error = new Error('default_visibility must be one of: private, aws_only, aws_community, public');
                error.name = 'InvalidParameterException';
                throw error;
            }
        }

        // Validate is_admin
        const isAdmin = userAttributes['custom:is_admin'];
        if (isAdmin && !['true', 'false'].includes(isAdmin)) {
            const error = new Error('is_admin must be either true or false');
            error.name = 'InvalidParameterException';
            throw error;
        }

        // Auto-confirm user if email verification is handled elsewhere
        event.response.autoConfirmUser = false;
        event.response.autoVerifyEmail = true;

        callback(null, event);
    } catch (error) {
        console.error('Pre-signup validation failed:', error);
        callback(error);
    }
};
`;

export default preSignupLambdaSource;
