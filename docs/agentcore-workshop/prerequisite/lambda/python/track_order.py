import boto3
import json
from datetime import datetime, timedelta
import re
from typing import Optional, Dict, List, Any

# Initialize DynamoDB client
dynamodb = boto3.resource('dynamodb')
ssm = boto3.client('ssm')

def get_order_tracking_table():
    """Get the order tracking table name from SSM parameter"""
    try:
        response = ssm.get_parameter(
            Name='/app/customersupport/dynamodb/order_tracking_table_name'
        )
        table_name = response['Parameter']['Value']
        return dynamodb.Table(table_name)
    except Exception as e:
        raise Exception(f"Failed to get order tracking table: {str(e)}")

def parse_relative_date(date_string: str) -> Optional[str]:
    """Parse relative date strings like 'last Friday', 'two weeks ago' into ISO date format"""
    today = datetime.now()
    date_string = date_string.lower().strip()
    
    # Handle "last [day of week]"
    days_of_week = {
        'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3,
        'friday': 4, 'saturday': 5, 'sunday': 6
    }
    
    for day_name, day_num in days_of_week.items():
        if f"last {day_name}" in date_string:
            days_back = (today.weekday() - day_num) % 7
            if days_back == 0:  # If today is the same day, go back a week
                days_back = 7
            target_date = today - timedelta(days=days_back)
            return target_date.strftime('%Y-%m-%d')
    
    # Handle "X days/weeks/months ago"
    time_patterns = [
        (r'(\d+)\s+days?\s+ago', 'days'),
        (r'(\d+)\s+weeks?\s+ago', 'weeks'),
        (r'(\d+)\s+months?\s+ago', 'months'),
        (r'yesterday', 'yesterday'),
        (r'last\s+week', 'last_week'),
        (r'last\s+month', 'last_month')
    ]
    
    for pattern, unit in time_patterns:
        match = re.search(pattern, date_string)
        if match:
            if unit == 'yesterday':
                target_date = today - timedelta(days=1)
            elif unit == 'last_week':
                target_date = today - timedelta(weeks=1)
            elif unit == 'last_month':
                target_date = today - timedelta(days=30)
            else:
                amount = int(match.group(1))
                if unit == 'days':
                    target_date = today - timedelta(days=amount)
                elif unit == 'weeks':
                    target_date = today - timedelta(weeks=amount)
                elif unit == 'months':
                    target_date = today - timedelta(days=amount * 30)
            
            return target_date.strftime('%Y-%m-%d')
    
    return None

def search_orders_by_natural_query(natural_query: str, customer_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Search orders using natural language query"""
    table = get_order_tracking_table()
    
    # Extract potential product names and dates from the query
    query_lower = natural_query.lower()
    
    # Try to parse dates from the query
    parsed_date = parse_relative_date(query_lower)
    
    # Common product keywords to search for
    product_keywords = [
        'iphone', 'macbook', 'airpods', 'ipad', 'watch', 'tv', 'headphones',
        'laptop', 'phone', 'tablet', 'console', 'playstation', 'xbox'
    ]
    
    matching_orders = []
    
    if customer_id:
        # Search by customer ID first
        try:
            response = table.query(
                IndexName='customer-index',
                KeyConditionExpression='customer_id = :customer_id',
                ExpressionAttributeValues={':customer_id': customer_id}
            )
            orders = response.get('Items', [])
        except Exception as e:
            print(f"Error querying by customer_id: {str(e)}")
            return []
    else:
        # Scan all orders (not ideal for production, but works for demo)
        try:
            response = table.scan()
            orders = response.get('Items', [])
        except Exception as e:
            print(f"Error scanning orders: {str(e)}")
            return []
    
    # Filter orders based on natural query
    for order in orders:
        match_score = 0
        
        # Check product name match
        product_name = order.get('product_name', '').lower()
        for keyword in product_keywords:
            if keyword in query_lower and keyword in product_name:
                match_score += 2
        
        # Check date match
        if parsed_date and order.get('order_date') == parsed_date:
            match_score += 3
        
        # Check for partial product name match
        query_words = query_lower.split()
        product_words = product_name.split()
        for query_word in query_words:
            if len(query_word) > 3:  # Only check words longer than 3 characters
                for product_word in product_words:
                    if query_word in product_word or product_word in query_word:
                        match_score += 1
        
        if match_score > 0:
            order['match_score'] = match_score
            matching_orders.append(order)
    
    # Sort by match score (highest first)
    matching_orders.sort(key=lambda x: x.get('match_score', 0), reverse=True)
    
    return matching_orders

def track_order(order_id: Optional[str] = None, tracking_id: Optional[str] = None, 
                customer_id: Optional[str] = None, natural_query: Optional[str] = None) -> str:
    """
    Track order status using various identifiers or natural language query
    
    Args:
        order_id: Specific order ID to look up
        tracking_id: Tracking ID to look up
        customer_id: Customer ID to filter orders
        natural_query: Natural language query about the order
    
    Returns:
        Formatted string with order status information
    """
    
    try:
        table = get_order_tracking_table()
        
        # Direct order ID lookup
        if order_id:
            try:
                response = table.get_item(Key={'order_id': order_id})
                if 'Item' in response:
                    order = response['Item']
                    return format_order_status(order)
                else:
                    return f"[CROSS MARK] Order {order_id} not found. Please check the order ID and try again."
            except Exception as e:
                return f"[CROSS MARK] Error looking up order {order_id}: {str(e)}"
        
        # Tracking ID lookup
        elif tracking_id:
            try:
                response = table.query(
                    IndexName='tracking-index',
                    KeyConditionExpression='tracking_id = :tracking_id',
                    ExpressionAttributeValues={':tracking_id': tracking_id}
                )
                
                if response['Items']:
                    order = response['Items'][0]
                    return format_order_status(order)
                else:
                    return f"[CROSS MARK] No order found with tracking ID {tracking_id}. Please verify the tracking number."
            except Exception as e:
                return f"[CROSS MARK] Error looking up tracking ID {tracking_id}: {str(e)}"
        
        # Natural language query
        elif natural_query:
            matching_orders = search_orders_by_natural_query(natural_query, customer_id)
            
            if not matching_orders:
                return f"[CROSS MARK] No orders found matching '{natural_query}'. Try being more specific or provide an order ID."
            
            elif len(matching_orders) == 1:
                return format_order_status(matching_orders[0])
            
            else:
                # Multiple matches - present options
                response = f"[LEFT-POINTING MAGNIFYING GLASS] Found {len(matching_orders)} orders matching '{natural_query}':\n\n"
                for i, order in enumerate(matching_orders[:5], 1):  # Limit to top 5 matches
                    response += f"{i}. Order {order['order_id']} - {order['product_name']} (Status: {order['status']}, Date: {order['order_date']})\n"
                
                if len(matching_orders) > 5:
                    response += f"\n... and {len(matching_orders) - 5} more orders.\n"
                
                response += "\nPlease provide a specific order ID for detailed information."
                return response
        
        # Customer ID only - show recent orders
        elif customer_id:
            try:
                response = table.query(
                    IndexName='customer-index',
                    KeyConditionExpression='customer_id = :customer_id',
                    ExpressionAttributeValues={':customer_id': customer_id}
                )
                
                orders = response.get('Items', [])
                if not orders:
                    return f"[CROSS MARK] No orders found for customer {customer_id}."
                
                # Sort by order date (most recent first)
                orders.sort(key=lambda x: x.get('order_date', ''), reverse=True)
                
                response_text = f"[PACKAGE] Recent orders for customer {customer_id}:\n\n"
                for order in orders[:5]:  # Show up to 5 recent orders
                    response_text += f"• Order {order['order_id']} - {order['product_name']} (Status: {order['status']}, Date: {order['order_date']})\n"
                
                response_text += "\nProvide a specific order ID for detailed tracking information."
                return response_text
                
            except Exception as e:
                return f"[CROSS MARK] Error looking up orders for customer {customer_id}: {str(e)}"
        
        else:
            return "[CROSS MARK] Please provide an order ID, tracking ID, customer ID, or describe your order (e.g., 'my iPhone order from last Friday')."
    
    except Exception as e:
        return f"[CROSS MARK] Error tracking order: {str(e)}"

def format_order_status(order: Dict[str, Any]) -> str:
    """Format order information into a readable status message"""
    
    status_emojis = {
        'processing': 'PENDING',
        'shipped': '[DELIVERY TRUCK]',
        'delivered': '[WHITE HEAVY CHECK MARK]',
        'cancelled': '[CROSS MARK]'
    }
    
    status = order.get('status', 'unknown')
    emoji = status_emojis.get(status, '[PACKAGE]')
    
    response = f"{emoji} **Order Status: {status.title()}**\n\n"
    response += f"[CLIPBOARD] **Order Details:**\n"
    response += f"• Order ID: {order.get('order_id', 'N/A')}\n"
    response += f"• Product: {order.get('product_name', 'N/A')}\n"
    response += f"• Order Date: {order.get('order_date', 'N/A')}\n"
    response += f"• Total: ${order.get('order_total', 0):.2f}\n"
    
    if order.get('tracking_id'):
        response += f"• Tracking ID: {order['tracking_id']}\n"
    
    if status == 'shipped' or status == 'processing':
        response += f"• Estimated Delivery: {order.get('estimated_delivery', 'N/A')}\n"
    
    if order.get('shipping_address'):
        addr = order['shipping_address']
        response += f"\n[HOUSE BUILDING] **Shipping Address:**\n"
        response += f"{addr.get('street', '')}\n"
        response += f"{addr.get('city', '')}, {addr.get('state', '')} {addr.get('zip_code', '')}\n"
    
    if order.get('items') and len(order['items']) > 1:
        response += f"\n[PACKAGE] **Items in this order:**\n"
        for item in order['items']:
            response += f"• {item.get('quantity', 1)}x {item.get('product_id', 'Unknown')} - ${item.get('price', 0):.2f}\n"
    
    # Add status-specific messages
    if status == 'delivered':
        response += f"\n[PARTY POPPER] Your order has been delivered! We hope you enjoy your purchase."
    elif status == 'shipped':
        response += f"\n[OPEN MAILBOX WITH RAISED FLAG] Your order is on its way! You can track it using the tracking ID above."
    elif status == 'processing':
        response += f"\n[GEAR] Your order is being prepared for shipment. We'll notify you when it ships."
    elif status == 'cancelled':
        response += f"\n[BROKEN HEART] This order has been cancelled. If you have questions, please contact customer support."
    
    return response
