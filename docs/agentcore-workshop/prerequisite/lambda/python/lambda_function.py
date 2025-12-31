from track_order import track_order
from get_customer_profile import get_customer_profile


def get_named_parameter(event, name):
    if name not in event:
        return None

    return event.get(name)


def lambda_handler(event, context):
    print(f"Event: {event}")
    print(f"Context: {context}")

    extended_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
    resource = extended_tool_name.split("___")[1]

    print(resource)

    if resource == "get_customer_profile":
        customer_id = get_named_parameter(event=event, name="customer_id")
        email = get_named_parameter(event=event, name="email")
        phone = get_named_parameter(event=event, name="phone")

        if not customer_id:
            return {
                "statusCode": 400,
                "body": "[CROSS MARK] Please provide customer_id",
            }

        try:
            customer_profile = get_customer_profile(
                customer_id=customer_id, email=email, phone=phone
            )
        except Exception as e:
            print(e)
            return {
                "statusCode": 400,
                "body": f"[CROSS MARK] {e}",
            }

        return {
            "statusCode": 200,
            "body": f"[BUST IN SILHOUETTE] Customer Profile Information: {customer_profile}",
        }

    elif resource == "track_order":
        order_id = get_named_parameter(event=event, name="order_id")
        tracking_id = get_named_parameter(event=event, name="tracking_id")
        customer_id = get_named_parameter(event=event, name="customer_id")
        natural_query = get_named_parameter(event=event, name="natural_query")

        try:
            order_status = track_order(
                order_id=order_id,
                tracking_id=tracking_id,
                customer_id=customer_id,
                natural_query=natural_query
            )
        except Exception as e:
            print(e)
            return {
                "statusCode": 400,
                "body": f"[CROSS MARK] {e}",
            }

        return {
            "statusCode": 200,
            "body": order_status,
        }

    return {
        "statusCode": 400,
        "body": f"[CROSS MARK] Unknown toolname: {resource}",
    }
