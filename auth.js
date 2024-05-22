const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const users = {
    "id1": { username: "elvin-khunt", password: "$2b$10$wV8/Pp7GwTmMyjC2e9QZUuEoJzZdNHP/1/FLpC0iP6qlPE0mclpEy" }, // "password123"
    "id2": { username: "hitesh-dhaduk", password: "$2b$10$7/nPfQOsuItC1uwIDUQY/O1ukMtD.E57V.D/SF6C/U1xX7.0cz/4C" }, // "mypassword"
    "id3": { username: "mukesh-khunt", password: "$2b$10$PL4oaTLDtsqUJz4RzBo5ouaT8XnWoXGu5EojRLEqobGZ/jM.z38/S" } // "secret"
};

passport.use(new LocalStrategy(
    function(username, password, done) {
        const user = Object.values(users).find(user => user.username === username);
        if (!user) {
            return done(null, false, { message: 'Incorrect username.' });
        }
        bcrypt.compare(password, user.password, function(err, res) {
            if (res) {
                return done(null, user);
            } else {
                return done(null, false, { message: 'Incorrect password.' });
            }
        });
    }
));

passport.serializeUser((user, done) => {
    done(null, user.username);
});

passport.deserializeUser((username, done) => {
    const user = Object.values(users).find(user => user.username === username);
    done(null, user);
});
