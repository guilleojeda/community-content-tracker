export const preSignupLambdaSource = `
const AWS = require('aws-sdk');
const cognito = new AWS.CognitoIdentityServiceProvider();

exports.handler = async (event, context, callback) => {
    console.log('Pre-signup trigger event:', JSON.stringify(event, null, 2));

    try {
        const { userAttributes } = event.request || {};
        const customUsername = userAttributes ? userAttributes['custom:username'] : undefined;
        const userPoolId = event.userPoolId;

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

            if (!userPoolId) {
                const error = new Error('User pool ID is required for username uniqueness checks');
                error.name = 'InvalidParameterException';
                throw error;
            }

            const listResponse = await cognito.listUsers({
                UserPoolId: userPoolId,
                Filter: 'custom:username = "' + customUsername + '"',
                Limit: 1,
            }).promise();

            if (listResponse.Users && listResponse.Users.length > 0) {
                const error = new Error('Username already exists');
                error.name = 'InvalidParameterException';
                throw error;
            }

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
