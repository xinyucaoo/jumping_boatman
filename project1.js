// Last edited by Dietrich Geisler 2025

const VSHADER_SOURCE = `
    attribute vec3 a_Position;
    uniform mat4 u_Model;
    uniform mat4 u_World;
    uniform mat4 u_Camera;
    uniform mat4 u_Projection;
    attribute vec3 a_Color;
    varying vec3 v_Color;
    void main() {
        gl_Position = u_Projection * u_Camera * u_World * u_Model * vec4(a_Position, 1.0);
        v_Color = a_Color;
    }
`

const FSHADER_SOURCE = `
    varying mediump vec3 v_Color;
    void main() {
        gl_FragColor = vec4(v_Color, 1.0);
    }
`

// references to general information
var g_canvas
var gl
var g_lastFrameMS

// GLSL uniform references
var g_u_model_ref
var g_u_world_ref
var g_u_camera_ref
var g_u_projection_ref

// camera projection values
var g_camera_x
var g_camera_y
var g_camera_z

// usual model/world matrices
var g_boatModel
var g_manModel
var g_diamondModel
var g_worldMatrix

// Mesh definitions
var g_boatMesh
var g_manMesh
var g_gridMesh
var g_diamondMesh;

// Matrix definitions
var g_boatMatrix
var g_manMatrix
var g_diamondMatrix;
var g_cameraMatrix;

var isJumping = false;
var jumpVelocity = 0;
var gravity = -0.01;
var initialY = 0;

// We're using triangles, so our vertices each have 3 elements
const TRIANGLE_SIZE = 3

// The size in bytes of a floating point
const FLOAT_SIZE = 4

// Add at top with other global variables
var diamondAngle = 0
var DIAMOND_ORBIT_SPEED = 0.005
var DIAMOND_ORBIT_RADIUS = 0.05
var diamondSelfRotation = 0
var DIAMOND_SELF_ROTATION_SPEED = 0.001

var CAMERA_TYPES = {ORTH: 0, PERSPECTIVE: 1}

var cameraType = CAMERA_TYPES.ORTH

function main() {
    // Setup our camera movement sliders
    slider_input = document.getElementById('sliderX')
    slider_input.addEventListener('input', (event) => {
        updateCameraX(event.target.value)
    })
    slider_input = document.getElementById('sliderY')
    slider_input.addEventListener('input', (event) => {
        updateCameraY(event.target.value)
    })
    slider_input = document.getElementById('sliderZ')
    slider_input.addEventListener('input', (event) => {
        updateCameraZ(event.target.value)
    })

    g_canvas = document.getElementById('canvas')

    // Get the rendering context for WebGL
    gl = getWebGLContext(g_canvas, true)
    if (!gl) {
        console.log('Failed to get the rendering context for WebGL')
        return
    }

    // We will call this at the end of most main functions from now on
    loadOBJFiles()
}

/*
 * Helper function to load OBJ files in sequence
 * For much larger files, you may are welcome to make this more parallel
 * I made everything sequential for this class to make the logic easier to follow
 */
async function loadOBJFiles() {
    // open our OBJ file(s)
    data = await fetch('./resources/airboat.obj').then(response => response.text()).then((x) => x)
    g_boatMesh = []
    readObjFile(data, g_boatMesh)

    data = await fetch('./resources/al.obj').then(response => response.text()).then((x) => x)
    g_manMesh = []
    readObjFile(data, g_manMesh)

    // load diamond
    data = await fetch('./resources/diamond.obj').then(response => response.text()).then((x) => x)
    g_diamondMesh = []
    readObjFile(data, g_diamondMesh)

    // Wait to load our models before starting to render
    startRendering()
}

function startRendering() {
    // Initialize GPU's vertex and fragment shaders programs
    if (!initShaders(gl, VSHADER_SOURCE, FSHADER_SOURCE)) {
        console.log('Failed to intialize shaders.')
        return
    }

    // initialize the VBO
    var gridInfo = buildGridAttributes(1, 1, [0.0, 1.0, 0.0])
    g_gridMesh = gridInfo[0]
    var boatColors = buildColorAttributes(g_boatMesh.length / 3)
    var manColors = buildColorAttributes(g_manMesh.length / 3)
    var diamondColors = buildColorAttributes(g_diamondMesh.length / 3)

    var data = g_boatMesh.concat(g_manMesh)
        .concat(g_diamondMesh)
        .concat(gridInfo[0])
        .concat(boatColors)
        .concat(manColors)
        .concat(diamondColors)
        .concat(gridInfo[1])
    if (!initVBO(new Float32Array(data))) {
        return
    }

    // Send our vertex data to the GPU
    if (!setupVec3('a_Position', 0, 0)) {
        return
    }
    if (!setupVec3('a_Color', 0, (g_boatMesh.length + g_manMesh.length + g_diamondMesh.length + gridInfo[0].length) * FLOAT_SIZE)) {
        return -1
    }

    // Get references to GLSL uniforms
    g_u_model_ref = gl.getUniformLocation(gl.program, 'u_Model')
    g_u_world_ref = gl.getUniformLocation(gl.program, 'u_World')
    g_u_camera_ref = gl.getUniformLocation(gl.program, 'u_Camera')
    g_u_projection_ref = gl.getUniformLocation(gl.program, 'u_Projection')

    // use a constant to make consistent scaling a bit cleaner to read
    const PSCALE = .05

    // Setup our model by scaling
    g_boatModel = new Matrix4()
    g_boatModel = g_boatModel
        .scale(.05, .05, .05)
        .rotate(180, 0, 1, 0)

    g_manModel = new Matrix4().scale(PSCALE, PSCALE, -PSCALE)

    g_boatMatrix = new Matrix4().rotate(90, 0, 1, 0).translate(0, -.38, -.5)
    g_manMatrix = new Matrix4().translate(-4.0*PSCALE, 2.0*PSCALE, 0).rotate(90, 0, 1, 0)
    // Add diamond model/matrix initialization
    const DSCALE = 0.0005
    g_diamondModel = new Matrix4().scale(DSCALE, DSCALE, DSCALE)
    // g_diamondMatrix = new Matrix4(g_manMatrix).translate(0, 0.5, 0)
    
    // Reposition our mesh (in this case as an identity operation)
    g_worldMatrix = new Matrix4()

    // Use a reasonable "default" perspective matrix
    g_projectionMatrix = new Matrix4()

    // Enable culling and depth tests
    gl.enable(gl.CULL_FACE)
    gl.enable(gl.DEPTH_TEST)

    // Setup for ticks
    g_lastFrameMS = Date.now()

    // Initially set our camera to be at the origin
    updateCameraX(0)
    updateCameraY(0)
    updateCameraZ(.01)

    tick()
}

// extra constants for cleanliness
var ROTATION_SPEED = .05

// function to apply all the logic for a single frame tick
function tick() {
    // time since the last frame
    var deltaTime

    // calculate deltaTime
    var current_time = Date.now()
    deltaTime = current_time - g_lastFrameMS
    g_lastFrameMS = current_time

    // rotate the boat around the Y axis consistently
    // note that we want to rotate _after_ translation, hence we need to reorder this operation
    g_boatMatrix = new Matrix4().rotate(
        deltaTime * ROTATION_SPEED, 0, 1, 0
    ).multiply(g_boatMatrix)

    // jump animation
    if (isJumping) {
        // Update the jump velocity with gravity
        jumpVelocity += gravity;

        // Update the man's position
        g_manMatrix = g_manMatrix.translate(0, jumpVelocity, 0);

        // Check if the man has landed (back to initial Y position or below)
        if (g_manMatrix.elements[13] <= initialY) {
            // Reset the man's position to the initial Y position
            g_manMatrix.elements[13] = initialY;
            isJumping = false; // Stop the jump
        }
    }

    // Update diamond rotation
    diamondAngle += deltaTime * DIAMOND_ORBIT_SPEED;
    diamondSelfRotation += deltaTime * DIAMOND_SELF_ROTATION_SPEED;

    draw()

    requestAnimationFrame(tick, g_canvas)
}

// draw to the screen on the next frame
function draw() {
    g_cameraMatrix = new Matrix4().setLookAt(
        g_camera_x, g_camera_y, g_camera_z,
        0, 0, 0,
        0, 1, 0
    )
    // Clear the canvas with a black background
    gl.clearColor(0.0, 0.0, 0.0, 1.0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    // Update with our global transformation matrices
    gl.uniformMatrix4fv(g_u_model_ref, false, g_boatModel.elements)
    gl.uniformMatrix4fv(g_u_world_ref, false, g_boatMatrix.elements)
    gl.uniformMatrix4fv(g_u_camera_ref, false, g_cameraMatrix.elements)
    gl.uniformMatrix4fv(g_u_projection_ref, false, g_projectionMatrix.elements)

    // draw our one model (the boat)
    gl.drawArrays(gl.TRIANGLES, 0, g_boatMesh.length / 3)

    // draw the man
    var local_manMatrix = new Matrix4(g_boatMatrix).multiply(g_manMatrix)    

    gl.uniformMatrix4fv(g_u_model_ref, false, g_manModel.elements)
    gl.uniformMatrix4fv(g_u_world_ref, false, local_manMatrix.elements)
    gl.drawArrays(gl.TRIANGLES, 
        g_boatMesh.length / 3, 
        g_manMesh.length / 3)

    var local_diamondMatrix = new Matrix4(local_manMatrix).translate(
        Math.cos(diamondAngle) * DIAMOND_ORBIT_RADIUS,
        0.2,
        Math.sin(diamondAngle) * DIAMOND_ORBIT_RADIUS)  
        .rotate(diamondSelfRotation * 360, 0, 1, 0)

    // Draw diamond
    gl.uniformMatrix4fv(g_u_model_ref, false, g_diamondModel.elements)
    gl.uniformMatrix4fv(g_u_world_ref, false, local_diamondMatrix.elements)
    gl.drawArrays(gl.TRIANGLES, 
        (g_boatMesh.length + g_manMesh.length) / 3,
        g_diamondMesh.length / 3)

    // the grid has a constant identity matrix for model and world
    // world includes our Y offset
    gl.uniformMatrix4fv(g_u_model_ref, false, new Matrix4().elements)
    gl.uniformMatrix4fv(g_u_world_ref, false, new Matrix4().translate(0, GRID_Y_OFFSET, 0).elements)

    // draw the grid
    gl.drawArrays(gl.LINES, (g_boatMesh.length + g_manMesh.length) / 3, g_gridMesh.length / 3)
    // gl.drawArrays(gl.LINES, g_manMesh.length / 3, g_gridMesh.length / 3)

}

// Helper to construct colors
// makes every triangle a slightly different shade of blue
function buildColorAttributes(vertex_count) {
    var colors = []
    for (var i = 0; i < vertex_count / 3; i++) {
        // three vertices per triangle
        for (var vert = 0; vert < 3; vert++) {
            var shade = (i * 3) / vertex_count
            colors.push(shade, shade, 1.0)
        }
    }

    return colors
}

function updateCameraX(amount) {
    label = document.getElementById('cameraX')
    label.textContent = `Camera X: ${Number(amount).toFixed(2)}`
    g_camera_x = Number(amount)
}
function updateCameraY(amount) {
    label = document.getElementById('cameraY')
    label.textContent = `Camera Y: ${Number(amount).toFixed(2)}`
    g_camera_y = Number(amount)
}
function updateCameraZ(amount) {
    label = document.getElementById('cameraZ')
    label.textContent = `Camera Z: ${Number(amount).toFixed(2)}`
    g_camera_z = Number(amount)
}

// How far in the X and Z directions the grid should extend
// Recall that the camera "rests" on the X/Z plane, since Z is "out" from the camera
const GRID_X_RANGE = 1000
const GRID_Z_RANGE = 1000

// The default y-offset of the grid for rendering
const GRID_Y_OFFSET = -0.5

/*
 * Helper to build a grid mesh and colors
 * Returns these results as a pair of arrays
 * Each vertex in the mesh is constructed with an associated grid_color
 */
function buildGridAttributes(grid_row_spacing, grid_column_spacing, grid_color) {
    var mesh = []
    var colors = []

    // Construct the rows
    for (var x = -GRID_X_RANGE; x < GRID_X_RANGE; x += grid_row_spacing) {
        // two vertices for each line
        // one at -Z and one at +Z
        mesh.push(x, 0, -GRID_Z_RANGE)
        mesh.push(x, 0, GRID_Z_RANGE)
    }

    // Construct the columns extending "outward" from the camera
    for (var z = -GRID_Z_RANGE; z < GRID_Z_RANGE; z += grid_column_spacing) {
        // two vertices for each line
        // one at -Z and one at +Z
        mesh.push(-GRID_X_RANGE, 0, z)
        mesh.push(GRID_X_RANGE, 0, z)
    }

    // We need one color per vertex
    // since we have 3 components for each vertex, this is length/3
    for (var i = 0; i < mesh.length / 3; i++) {
        colors.push(grid_color[0], grid_color[1], grid_color[2])
    }

    return [mesh, colors]
}

/*
 * Initialize the VBO with the provided data
 * Assumes we are going to have "static" (unchanging) data
 */
function initVBO(data) {
    // get the VBO handle
    var VBOloc = gl.createBuffer()
    if (!VBOloc) {
        return false
    }

    // Bind the VBO to the GPU array and copy `data` into that VBO
    gl.bindBuffer(gl.ARRAY_BUFFER, VBOloc)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)

    return true
}

/*
 * Helper function to load the given vec3 data chunk onto the VBO
 * Requires that the VBO already be setup and assigned to the GPU
 */
function setupVec3(name, stride, offset) {
    // Get the attribute by name
    var attributeID = gl.getAttribLocation(gl.program, `${name}`)
    if (attributeID < 0) {
        console.log(`Failed to get the storage location of ${name}`)
        return false
    }

    // Set how the GPU fills the a_Position variable with data from the GPU 
    gl.vertexAttribPointer(attributeID, 3, gl.FLOAT, false, stride, offset)
    gl.enableVertexAttribArray(attributeID)

    return true
}


function jump() {
    if (!isJumping) {
        isJumping = true;
        jumpVelocity = 0.1; // Initial jump velocity
        initialY = g_manMatrix.elements[13]; // Store the initial Y position
    }
}

function setOrthographic() {
    cameraType = CAMERA_TYPES.ORTH
    g_projectionMatrix = new Matrix4()
    updateCameraZ(.01)
}

function setPerspective() {
    cameraType = CAMERA_TYPES.PERSPECTIVE
    g_projectionMatrix = new Matrix4().setPerspective(90, 1, 0.1, 100)
    updateCameraZ(1.2)
}