/**
 * Updates the last touch coordinates based on the event type.
 * If the event is 'touchstart', it takes the coordinates from the touch object.
 * If the event is 'mousedown', it takes the coordinates directly from the event object.
 *
 * @param {Event} e - The event object containing information about the touch or mouse event.
 */
const update_last_touch_coordinates = (e)=>{
    if(e.type == 'touchstart'){
        var touch = e.originalEvent.touches[0] || e.originalEvent.changedTouches[0];
        window.last_touch_x = touch.pageX;
        window.last_touch_y = touch.pageY;
    } else if (e.type == 'mousedown') {
        window.last_touch_x = e.clientX;
        window.last_touch_y = e.clientY;
    }
}

export default update_last_touch_coordinates;