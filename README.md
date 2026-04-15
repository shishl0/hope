# HOPE

 
## Members:
* Miras Rakhmetolla  
* Bizhan Kanat  
* Yernazar Altynbekov

# The Next Gen Web-Tank Combat
A KBTU Web Development Project | Django • Angular • Three.js • DRF • Maya

### The Vision
Our team is building a full-scale multiplayer tank game that runs right in your browser. We aren't just making a website; we are combining Autodesk MAYA for 3D modeling, Three.js for the game engine, and the power of Django and Angular to manage the whole ecosystem.

Imagine a world where you log in, customize your heavy war machine, choose your side (USSR or Germany), and jump into a 3D arena to dominate the leaderboard.

---

### Front-End: The Command Center (Angular)
We are using Angular to build the entire "Command Center" of the game. This is the UI where everything happens before the battle starts.

When you open the app, you’ll see a sleek interface for Registration and Login. We’re implementing a secure system (**JWT**) so your progress, kills, and tank collection are always safe. Inside the Garage, we use Angular's dynamic features to display your tanks—you can scroll through your collection and pick your favorite machine.

We also have a Profile and Faction system. Whether you want to represent the Red Army or the Axis, you can switch roles and see your stats update in real-time. Want to start a fight? The Lobby and Map Selection screen will find other players and get the coordinates ready for the 3D engine.

---

### Back-End: The Engine Room (Django & DRF)
Under the hood, Django REST Framework is doing all the heavy lifting. We’ve designed a database that tracks everything:

* Users & Stats: Your ID, username, total kills, and global ranking.
* The Garage: Every tank you own is an "instance" connected to your account.
* Tank Models: This is where we store the "DNA" of the tanks—their names, speed, armor, and even the links to the 3D files (body and turret) we made in MAYA.
* Battlefields: Every location has its own size, specific coordinates, and a list of players currently in the session.

To keep things fast, we’re using Serializers to send all this data to the front-end instantly. We also plan to explore WebSockets to make sure that when you shoot, the server knows about it immediately.

---

### Tools of War
* Autodesk MAYA: Used to craft the high-poly tank models, turrets, and terrain.
* Three.js: The bridge that brings our 3D models to life on the web.
* Angular: Our choice for a fast, responsive user interface and state management.
* Django & DRF: The backbone that handles our API, security, and game logic.

---

### Why This Project?
We want to prove that web development isn't just about forms and text—it's about creating immersive experiences. By the end of this project, we will have a fully synchronized system where a 3D battle in the browser is powered by a professional-grade Django backend.
