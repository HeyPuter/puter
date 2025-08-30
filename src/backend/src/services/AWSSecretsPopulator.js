const { createTransformedValues, DO_NOT_DEFINE } = require("../util/objutil");
const BaseService = require("./BaseService");
const { SecretsManagerClient, GetSecretValueCommand} = require("@aws-sdk/client-secrets-manager");


class AWSSecretsPopulator extends BaseService {
    async _run_as_early_as_possible() {

        
        const secret_name = "puter-secrets";

        const client = new SecretsManagerClient({
            region: "us-west-2"
        });

        let response;

        try {
            response = await client.send(
                new GetSecretValueCommand({
                    SecretId: secret_name,
                    VersionStage: "AWSCURRENT", // VersionStage defaults to AWSCURRENT if unspecified
                })
            );

            const secretOverlay = (JSON.parse(response.SecretString));
            const config = this.global_config;

            config.__set_config_object__(createTransformedValues(this.global_config, {
                mutateValue: (value, { state }) => {

                    const path = state.keys.join('.'); // or jq
                    if (value === "$__AWS_SECRET__") {
                        if (!secretOverlay[path]) {
                            throw new Error("Value wants an AWS Secrets key value, but no such value is in AWS secrets!");
                        }
                        return secretOverlay[path];
                    } else {
                        return DO_NOT_DEFINE;
                    }
                },
                doNotProcessArrays: true
            }));
        } catch (error) {
            // Just dont do anything
        }


    }
}

module.exports = {
    AWSSecretsPopulator
}